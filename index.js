/**
 * dsh-hindsight-memory — long-term conversation memory for DeepSeek Harness.
 *
 * What it does
 *  1. Lifecycle: probes the local Hindsight server, starts it when it is down
 *     (docker / compose / plain process), waits for health, and stops what it started
 *     on DSH exit unless `service.keep_alive_on_exit` is set.
 *  2. Routing: every workspace maps to a Hindsight bank (`bank.workspace_bank_mapping`
 *     or the `bank.name_template`), so sessions in one directory share one memory.
 *  3. Retain: after each turn the new turns are pushed to the bank asynchronously —
 *     the hook returns immediately, the network work happens off the critical path.
 *  4. Recall: before every model step the user prompt queries the bank, results are
 *     reranked server-side, filtered client-side, and injected as one synthetic user
 *     message right before the model call.
 *  5. Prune: once a session grows past the configured turn count, the oldest region is
 *     folded into a summary through the official compaction engine, which is what
 *     actually saves context tokens.
 *
 * Failure policy: every step is wrapped. If Hindsight is missing, slow, rate-limited or
 * broken, the plugin logs one warning and DSH behaves exactly as it would without it.
 */
import { probeLlmReachable } from './lib/llmprobe.js'
import { createRuntime } from './lib/runtime.js'
import { errorMessage } from './lib/log.js'
import { buildConfigSchema, loadSchemastery, plainConfig } from './lib/schema.js'
import { ROUTE_PATH, createRpcHandler, serveRpc } from './lib/rpc.js'
import { resolveDshDefaultLlm } from './lib/host.js'
import { requestReinstall } from './lib/lifecycle.js'

export const name = 'dsh-hindsight-memory'
/**
 * No hard service dependencies: every hook is optional and every call degrades.
 */
export const inject = []

/**
 * Settings-panel schema, built from the running dsh's own schemastery (see lib/schema.js).
 * Undefined when it cannot be resolved: the plugin then behaves exactly as before.
 */
const z = await loadSchemastery({ log: (m) => { if (process.env.DSH_HINDSIGHT_DEBUG_SCHEMA) console.error('[dsh-hindsight] ' + m) } }).catch(() => null)
if (process.env.DSH_HINDSIGHT_DEBUG_SCHEMA) console.error('[dsh-hindsight] schemastery ' + (z ? 'resolved' : 'NOT resolved') + ' argv1=' + process.argv[1])
export const Config = z ? buildConfigSchema(z) : undefined

/** Recording view of ctx so one runtime generation can be torn down on a live config edit. */
function scopedCtx(ctx) {
  const disposers = []
  const on = (...args) => {
    const off = ctx.on(...args)
    if (typeof off === 'function') disposers.push(off)
    return off
  }
  const inject = (...args) => {
    const fork = ctx.inject(...args)
    if (fork && typeof fork.dispose === 'function') disposers.push(() => fork.dispose())
    return fork
  }
  // A Proxy, not Object.create(): Cordis contexts are reflective proxies themselves and
  // resolve getters against the receiver, which recursed through an inherited `on`.
  const scoped = new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'on') return on
      if (prop === 'inject') return inject
      return Reflect.get(target, prop, target)
    }
  })
  return {
    ctx: scoped,
    dispose() {
      for (const off of disposers.splice(0).reverse()) {
        try { off() } catch { /* already gone */ }
      }
    }
  }
}

function startGeneration(ctx, rawConfig, reason) {
  const { runtime, config } = createRuntime({ rawConfig, ctx })
  const logger = runtime.logger
  logger.info(
    `plugin loaded (${reason}; setup=${config.setup} service=${config.service.base_url} mode=${config.service.mode} ` +
      `autostart=${config.service.autostart} recall=${config.recall.enabled} ` +
      `retain=${config.retain.enabled} prune=${config.prune.enabled})`
  )
  // Kill switch: `enabled: false` must not start a server, must not send a single byte of
  // conversation data anywhere, and must not touch model-visible history.
  if (!config.enabled) {
    logger.info('plugin disabled by config (enabled=false); DSH runs with its native context only')
    return { runtime, config, rawConfig, stop: async () => {} }
  }
  const scope = scopedCtx(ctx)
  runtime.attach(scope.ctx)
  // Boot is deliberately NOT awaited: activation must stay fast.
  void (async () => {
    await applyLlmMode(ctx, runtime, config)
    await runtime.boot(reason)
  })()
  return {
    runtime,
    config,
    rawConfig,
    async stop() {
      scope.dispose()
      await runtime.shutdown()
    }
  }
}

/**
 * Extraction LLM for a server this plugin launches (setup=local):
 * - follow (default): dsh's default model via official services (lib/host.js); a missing key
 *   falls back to provider "none" (raw chunks only) and the panel says so;
 * - custom: the llm.* fields; none: no extraction.
 * An attached server keeps its own LLM settings: nothing can be injected into it.
 */
async function applyLlmMode(ctx, runtime, config) {
  const llm = config.llm
  if (llm.mode === 'none') {
    Object.assign(llm, { provider: 'none', api_key: '' })
    runtime.llmStatus = { mode: 'none', effective: 'none' }
    return
  }
  if (llm.mode !== 'follow') {
    runtime.llmStatus = { mode: 'custom', effective: llm.provider ? `${llm.provider}/${llm.model}` : 'none', fallback: !llm.provider }
    return
  }
  const r = await resolveDshDefaultLlm(ctx).catch((error) => ({ ok: false, reason: errorMessage(error) }))
  runtime.followSignature = r.llm ? `${r.llm.provider}|${r.llm.base_url}|${r.llm.model}|${r.keyRef}|${r.ok}` : `none|${r.reason}`
  if (r.ok) {
    // A loopback gateway only dsh can use (Tauri: cline-pass on 127.0.0.1) would make every
    // async retain fail extraction in Hindsight; fall back to raw chunks and say so instead.
    // Warn only: a relay that refuses under load (ClinePass 429s seen as "Connection error")
    // recovers, so falling back to raw chunks would lose extraction for good. Throttling +
    // retries (lib/ops.js, 同时处理数) handle the transient case.
    const probe = await probeLlmReachable(r.llm.base_url, { fetchImpl: runtime.fetchImpl })
    if (!probe.ok) r.warning = probe.reason
  }
  if (r.ok) {
    Object.assign(llm, { provider: r.llm.provider, base_url: r.llm.base_url, model: r.llm.model, api_key: r.llm.api_key })
    runtime.llmStatus = { mode: 'follow', effective: `${r.llm.provider}/${r.llm.model}`, dshProvider: r.dshProvider, keyRef: r.keyRef, keySource: r.keySource, warning: r.warning || '' }
    if (r.warning) runtime.logger.warn(`extraction LLM: ${r.warning}`)
  } else {
    Object.assign(llm, { provider: '', api_key: '' })
    runtime.llmStatus = { mode: 'follow', effective: 'none', fallback: true, reason: r.reason, suggested: r.llm ? { provider: r.llm.provider, base_url: r.llm.base_url, model: r.llm.model } : null, keyRef: r.keyRef }
    runtime.logger.info(`extraction LLM: cannot follow dsh default model (${r.reason}); using "none" (raw chunks only)`)
  }
}

/** `/memory-retain [all|status]` — TUI equivalent of the panel's "retain now" button. */
function registerCommand(ctx, current) {
  const handler = async (invocation) => {
    const arg = String(invocation?.rawInput || '').trim()
    const runtime = current().runtime
    if (arg === 'status') {
      const j = runtime.job
      return { kind: 'success', text: j ? `${j.kind}: ${j.running ? 'running' : 'done'} ${j.done}/${j.total} retained=${j.scanned} skipped=${j.skipped} archived=${j.archived} failed=${j.failed}` : 'no memory job yet' }
    }
    const cwd = invocation?.agent?.session?.header?.cwd
    const filter = arg === 'all' || !cwd ? {} : { workspaces: [cwd] }
    const r = await runtime.runJob('manual', filter)
    if (!r.started) return { kind: 'error', text: `not started: ${r.reason || 'a job is already running'}` }
    return { kind: 'success', text: `memory retain started for ${filter.workspaces ? cwd : 'all unarchived sessions'}; /memory-retain status for progress` }
  }
  ctx.inject(['commands'], (c) => {
    c.effect(() => c.commands.register({ definitionId: 'dsh-hindsight-memory', name: 'memory-retain', description: 'Write unarchived sessions into Hindsight now (all | status)', handler }))
  })
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} rawConfig plain config, or a Volatile ref when `Config` is active
 */
export function apply(ctx, rawConfig = {}) {
  const read = () => plainConfig(rawConfig)
  let current = startGeneration(ctx, read(), 'startup')
  let chain = Promise.resolve()

  // Settings-panel edits arrive as volatile updates (no remount): swap the runtime.
  const reload = () => {
    chain = chain.then(async () => {
      const previous = current
      await previous.stop().catch(() => {})
      current = startGeneration(ctx, read(), 'settings-updated')
    }).catch((error) => current?.runtime?.logger?.warn?.(`reload failed: ${errorMessage(error)}`))
    return chain
  }
  ctx.on('loader/volatile-update', () => { void reload() })

  const getCurrent = () => current
  // Panel channel: an exact owner-only route on dsh's shared /api channel, registered through
  // the official Connection service (`connection.fetch.register`). Connection authenticates
  // the browser and rejects non-owner principals before the request reaches us.
  ctx.inject(['connection'], (c) => {
    try {
      const handler = createRpcHandler({ ctx, current: getCurrent, reload, requestReinstall })
      c.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => serveRpc(handler, request)
      })
      current.runtime.logger.info(`panel channel ${ROUTE_PATH} registered`)
    } catch (error) {
      current.runtime.logger.warn(`panel channel unavailable: ${errorMessage(error)}`)
    }
  })
  try { registerCommand(ctx, getCurrent) } catch { /* no commands service */ }

  // Follow dsh's default model: relaunch the local server when the selection changes.
  const followTimer = setInterval(async () => {
    const { runtime, config } = current
    if (config.setup !== 'local' || config.llm.mode !== 'follow' || runtime.followSignature === undefined) return
    const r = await resolveDshDefaultLlm(ctx).catch(() => null)
    if (!r) return
    const sig = r.llm ? `${r.llm.provider}|${r.llm.base_url}|${r.llm.model}|${r.keyRef}|${r.ok}` : `none|${r.reason}`
    if (sig !== runtime.followSignature) {
      runtime.logger.info('dsh default model changed: restarting local Hindsight with the new extraction LLM')
      void reload()
    }
  }, 30000)
  followTimer.unref?.()
  ctx.effect(() => () => clearInterval(followTimer))

  ctx.effect(() => () => chain.then(() => current.stop()))

  const handle = {
    name,
    get runtime() { return current.runtime },
    reload,
    stats: () => ({ ...current.runtime.stats, service: current.runtime.service.state, enabled: current.config.enabled })
  }
  return handle
}

// The loader takes the default export as the plugin runtime, so the named exports must
// also hang off it — otherwise `runtime.Config` is undefined and the settings host
// never lists this namespace.
Object.assign(apply, { Config, inject })
Object.defineProperty(apply, 'name', { value: name })
export default apply

/** Exported for tests and for `scripts/selftest.mjs`. */
export { createRuntime, errorMessage }
