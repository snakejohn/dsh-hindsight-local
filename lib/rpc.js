import { DEFAULT_CONFIG } from './config.js'
import { keyStates, readDotenv, clearDotenvKeys } from './keystate.js'
import { writeDotenvKeys, inlineKeys, KEY_VARS } from './dotenv.js'
/**
 * Plugin <-> panel channel. Registered on the official Connection service as an exact route on
 * the shared API channel: `ctx.connection.fetch.register({ path: '/api/dsh-hindsight', ... })`
 * (packages/client/connection/src/rpc.ts, HostConnectionFetch). Connection applies its
 * Host/Origin fence and browser authentication, and only owner Peers reach exact routes.
 * The browser POSTs `{ endpoint, payload }` and gets the `{ ok, value | error }` envelope.
 * Keys never leave the server: model listing, bank listing and memory search run here.
 */
import { PRESETS, listingKind, fetchModels } from './presets.js'
import { listWorkspaces, resolveDshDefaultLlm } from './host.js'
import { errorMessage, defaultLogFile } from './log.js'
import { resolveBankId } from './bank.js'
import { exportLogs, cleanupLogs, DEFAULT_LOG_DIR } from './logfiles.js'
import { readFileSync as readFileSyncFs } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname as dirnameP, basename as basenameP } from 'node:path'

export const ISSUE_URL = 'https://github.com/snakejohn/dsh-hindsight-local/issues/new?template=bug_report.yml'
export function pluginVersion() {
  try { return JSON.parse(readFileSyncFs(new URL('../package.json', import.meta.url), 'utf8')).version } catch { return '' }
}
/** Show the exported file in the OS file manager (best effort, never throws). */
export function revealFile(file, platform = process.platform) {
  try {
    const [cmd, args] = platform === 'win32' ? ['explorer.exe', ['/select,', file]] : platform === 'darwin' ? ['open', ['-R', file]] : ['xdg-open', [dirnameP(file)]]
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false })
    c.on('error', () => {})
    c.unref()
    return true
  } catch { return false }
}

export const ROUTE_PATH = '/api/dsh-hindsight'

/** Fetch adapter for the exact route. */
export async function serveRpc(handler, request) {
  let body
  try { body = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }
  const result = await handler(String(body?.endpoint || ''), body?.payload, request.signal, { principal: { kind: 'owner' } })
  return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

const ok = (value) => ({ ok: true, value })
const fail = (code, message) => ({ ok: false, error: { code: `dsh-hindsight/${code}`, message, details: {} } })

export function createRpcHandler({ ctx, current, fetchImpl, reload, requestReinstall }) {
  const endpoints = {
    async overview() {
      const { runtime, config } = current()
      const svc = runtime.service
      let version = null
      if (svc.ready) version = await runtime.client.version({ timeoutMs: 3000 }).catch(() => null)
      return {
        setup: config.setup,
        enabled: config.enabled,
        baseUrl: config.service.base_url,
        state: svc.state,
        ready: !!svc.ready,
        lastError: svc.lastError || '',
        version,
        localPlan: svc.localPlan ? { runner: svc.localPlan.runner, variant: svc.localPlan.variant, kind: svc.localPlan.kind } : null,
        controlPlaneUrl: svc.cpChild ? svc.controlPlaneUrl : '',
        controlPlaneEnabled: !!config.service.local?.control_plane?.enabled,
        llm: runtime.llmStatus || { mode: config.llm.mode },
        stats: runtime.stats,
        job: runtime.job,
        ops: runtime.ops ? runtime.ops.summary() : null,
        gateway: runtime.gateway || null,
        importPrompt: runtime.importPrompt ? runtime.importPrompt() : false,
        lastBank: runtime.activity?.lastBank || runtime.lastRecall?.bank || "",
        recent: runtime.recent.slice(0, 15),
        failures: runtime.failures.slice(0, 15),
        ...(() => { const ks = keyStates({ inline: current().rawConfig || {}, env: process.env, dotenv: readDotenv(), config }); return { keyState: ks, keysSet: { embedding: ks.embedding.set, reranker: ks.reranker.set, llm: ks.llm.set } } })(),
        keysInPatch: (() => { const raw = current().rawConfig || {}; const ks = inlineKeys(raw); const env = readDotenv(); return Object.keys(ks).length > 0 && Object.keys(ks).every((k) => !!env[KEY_VARS[k]]) })(),
        deploy: svc.deployStatus ? await svc.deployStatus().catch(() => null) : null
      }
    },
    async workspaces() {
      const r = await listWorkspaces(ctx)
      // `autoBank` = the bank 「新建库」 gives this workspace (template, ignoring mappings/default_bank).
      try {
        const cfg = current().config
        const bare = { ...cfg, bank: { ...cfg.bank, default_bank: '', workspace_bank_mapping: {} } }
        for (const w of r?.workspaces || []) {
          w.autoBank = resolveBankId({ workspacePath: w.path, config: bare }).bankId
          const r2 = resolveBankId({ workspacePath: w.path, config: cfg })
          w.bank = r2.bankId
          w.bankName = r2.displayName || w.title || ''
          // Backfill readable names for banks created before v0.1.3 (only when still unnamed).
          const rt = current().runtime
          if (rt?.service?.ready && rt.nameBank) void rt.nameBank(w.bank, r2.rule.startsWith('template') ? (w.title || r2.displayName) : r2.displayName)
        }
      } catch { /* listing still useful without bank names */ }
      return r
    },
    async banks() {
      const { runtime } = current()
      if (!runtime.service.ready) return { available: false, banks: [] }
      const banks = await runtime.client.listBanks()
      const out = []
      for (const b of banks.slice(0, 100)) {
        const id = b.bank_id || b.id
        const stats = await runtime.client.stats(id).catch(() => null)
        out.push({ id, name: b.name || '', stats })
      }
      return { available: true, banks: out }
    },
    async memories({ bank, q = '', limit = 30, offset = 0 } = {}) {
      const { runtime } = current()
      if (!bank) throw new Error('bank is required')
      // Paged server-side (Hindsight returns total), so 600+ memories never travel at once.
      const lim = Math.max(1, Math.min(50, Number(limit) || 10))
      const res = await runtime.client.listMemories(String(bank), { q: String(q).slice(0, 200), limit: lim, offset: Math.max(0, Number(offset) || 0) })
      const items = (res?.items || []).map((m) => ({ id: m.id, text: m.text, fact_type: m.fact_type, date: m.date, mentioned_at: m.mentioned_at, occurred_start: m.occurred_start, occurred_end: m.occurred_end }))
      return { items, total: Number(res?.total ?? items.length), offset: Number(res?.offset ?? offset) || 0, limit: lim }
    },
    async presets() {
      // `defaults` = the plugin's built-in values, shown as pre-filled fields in the panel.
      const D = DEFAULT_CONFIG
      const pick = (c) => ({ preset: c.preset, provider: c.provider, base_url: c.base_url, model: c.model })
      return { ...PRESETS, defaults: { embedding: { ...pick(D.embedding), expected_dim: D.embedding.expected_dim }, reranker: pick(D.reranker), llm: { ...pick(D.llm), mode: D.llm.mode } } }
    },
    /** Keys go to the plugin .env only (never dsh's cordis.patch.yml); restart to pick them up. */
    async saveKeys({ keys = {} } = {}) {
      const r = writeDotenvKeys(keys)
      if (r.error) return { ok: false, error: r.error, written: [] }
      if (r.written.length && reload) void reload()
      return { ok: true, written: r.written }
    },
    /** 清除密钥: drop key lines from the plugin .env (the panel clears dsh's plugin config itself). */
    async clearKeys() {
      const removed = clearDotenvKeys()
      return { ok: true, removed }
    },
    async models({ channel, preset = '', provider = '', base_url = '', api_key = '' } = {}) {
      const { config } = current()
      if (!['embedding', 'reranker', 'llm'].includes(channel)) throw new Error('bad channel')
      // An empty key field means "use the saved one": the panel never receives saved keys.
      const key = api_key || config[channel]?.api_key || ''
      const kind = listingKind(channel, preset, provider, base_url)
      return fetchModels({ kind, baseUrl: base_url, apiKey: key, channel, fetchImpl })
    },
    /** Simple-mode key check: is this SiliconFlow key usable? (plain-language result) */
    async checkKey({ api_key = '', base_url = 'https://api.siliconflow.cn/v1' } = {}) {
      const key = String(api_key).trim() || current().config.embedding?.api_key || ''
      if (!key) return { ok: false, what: '还没有填写密钥', how: '到 cloud.siliconflow.cn →「API 密钥」复制一个 sk- 开头的密钥粘贴进来。' }
      if (/\s/.test(key) || /[^\x21-\x7e]/.test(key)) return { ok: false, what: '密钥里混进了空格或中文字符', how: '请重新复制，只粘贴 sk- 开头的那一串，不要带空格。' }
      const f = fetchImpl || fetch
      try {
        const res = await f(`${base_url.replace(/\/+$/, '')}/models?type=text&sub_type=embedding`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(10000), redirect: 'error' })
        if (res.status === 401 || res.status === 403) return { ok: false, what: '硅基流动说这个密钥不对（可能复制不完整或已被删除）', how: '回到 cloud.siliconflow.cn →「API 密钥」，新建一个密钥，完整复制后重新粘贴。' }
        if (!res.ok) return { ok: false, what: `硅基流动暂时没有正常回应（错误码 ${res.status}）`, how: '稍等一分钟后点「重试」。' }
        const body = await res.json().catch(() => ({}))
        const bal = body?.data?.totalBalance ?? body?.data?.balance
        return { ok: true, balance: bal == null ? null : String(bal) }
      } catch (error) {
        return { ok: false, what: '连不上硅基流动的网站', how: '检查电脑是否能上网；开了代理/VPN 的话试试关掉，然后点「重试」。', detail: errorMessage(error) }
      }
    },
    /** 检测连接：probe /health now (and boot if it is down and autostart allows). */
    async checkConnection() {
      const { runtime } = current()
      const probe = await runtime.client.health({ timeoutMs: 5000 }).catch((e) => ({ ok: false, error: e.message }))
      if (!probe.ok && runtime.service.ensureReady) void runtime.service.ensureReady?.('panel-check')
      return { ok: !!probe.ok, status: probe.status ?? null, error: probe.ok ? '' : (probe.error || `HTTP ${probe.status}`), baseUrl: current().config.service.base_url }
    },
    /** 重启服务: stop this generation (kills our child) and boot a fresh one. */
    async restart() {
      if (!reload) return { ok: false, error: 'reload unavailable' }
      void reload()
      return { ok: true }
    },
    /** 重新部署: forget the venv install marker, then restart (pip runs again). */
    async redeploy() {
      if (!reload) return { ok: false, error: 'reload unavailable' }
      requestReinstall?.()
      void reload()
      return { ok: true }
    },
    /** .env echo for the panel (keys masked). */
    async dotenv() {
      const { maskedDotenv } = await import('./dotenv.js')
      return maskedDotenv()
    },
    /**
     * Compact status for the sidebar indicator. With `wait` + `since`, the call is held open
     * (long-poll, ≤25 s) until the status signature changes, so the server pushes updates
     * over the same owner-only Connection route instead of the client polling blindly.
     */
    async sidebar({ since = '', wait = false } = {}) {
      const deadline = Date.now() + 25000
      for (;;) {
        const v = await sidebarStatus(current())
        if (!wait || v.sig !== since || Date.now() > deadline) return v
        await new Promise((r) => setTimeout(r, 1000))
      }
    },
    async dshLlm() {
      const r = await resolveDshDefaultLlm(ctx)
      // Report where the key comes from, never the key itself.
      return { ok: r.ok, reason: r.reason, dshProvider: r.dshProvider, keyRef: r.keyRef, keySource: r.keySource,
        llm: r.llm ? { provider: r.llm.provider, base_url: r.llm.base_url, model: r.llm.model, hasKey: !!r.llm.api_key } : null }
    },
    async retainNow({ sessionIds = [], workspaces = [] } = {}) {
      const { runtime } = current()
      return runtime.runJob('manual', { sessionIds, workspaces })
    },
    async sessions({ workspace = '' } = {}) {
      const { runtime } = current()
      return { sessions: runtime.listSessions ? await runtime.listSessions({ workspace: String(workspace) }) : [] }
    },
    async dismissImport() {
      current().runtime.dismissImport?.('dismissed')
      return { ok: true }
    },
    /** 「重试失败项」: re-queue every failed retain operation now (same document ids, no duplicates). */
    /** 「导出日志」: one redacted txt (recent plugin + Hindsight + install logs and a settings summary). */
    async exportLogs({ reveal = true } = {}) {
      const { runtime, config } = current()
      const dir = DEFAULT_LOG_DIR()
      try { cleanupLogs(dir) } catch { /* ignore */ }
      const pluginLog = config?.logging?.file || runtime?.logger?.file || defaultLogFile()
      const summary = {
        setup: config?.setup, service: { mode: config?.service?.mode, base_url: config?.service?.base_url, local: config?.service?.local },
        embedding: { provider: config?.embedding?.provider, model: config?.embedding?.model, base_url: config?.embedding?.base_url },
        reranker: { provider: config?.reranker?.provider, model: config?.reranker?.model },
        llm: { mode: config?.llm?.mode, provider: config?.llm?.provider, model: config?.llm?.model, base_url: config?.llm?.base_url },
        bank: config?.bank, state: runtime?.service?.state, gateway: runtime?.gateway || null, ops: runtime?.ops?.summary?.() || null
      }
      const files = [pluginLog, pluginLog && pluginLog + '.1', 'hindsight.log', 'hindsight.log.1', 'install.log'].filter(Boolean)
      const file = exportLogs({ dir, files, version: pluginVersion(), summary })
      return { file, name: basenameP(file), revealed: reveal ? revealFile(file) : false, issueUrl: ISSUE_URL }
    },
    async retryFailed() {
      const { runtime } = current()
      if (!runtime.ops) return { retried: 0 }
      if (runtime.adoptFailedOps) await runtime.adoptFailedOps()
      const retried = await runtime.ops.retryAll()
      return { retried, ops: runtime.ops.summary() }
    }
  }
  return async (endpoint, payload, _signal, peer) => {
    if (peer?.principal && peer.principal.kind !== 'owner') return fail('forbidden', 'owner only')
    const fn = endpoints[endpoint]
    if (!fn) return fail('not-found', `unknown endpoint ${endpoint}`)
    try {
      return ok(await fn(payload || {}))
    } catch (error) {
      return fail('error', errorMessage(error))
    }
  }
}


/** green = ready, yellow = starting/deploying, gray = not set up / disabled, red = error. */
export async function sidebarStatus({ runtime, config }) {
  const svc = runtime.service
  const d = svc.deploy || {}
  let level = 'red'
  let text = '出问题了'
  let reason = svc.lastError || ''
  let progress = null
  if (!config.enabled) { level = 'gray'; text = '已关闭'; reason = '' }
  else if (svc.ready) { level = 'green'; text = '记忆正常'; reason = '' }
  else if (config.setup === 'unset' && config.service.mode === 'auto') { level = 'gray'; text = '需要设置'; reason = '点这里，填一个密钥就能用' }
  else if (svc.state === 'starting' || (svc.pending && !svc.lastError)) {
    level = 'yellow'
    const steps = d.steps || []
    const doneN = steps.filter((x) => x.status === 'done').length
    const run = steps.find((x) => x.status === 'running')
    text = '正在准备'
    progress = steps.length ? { done: doneN, total: steps.length, step: run ? run.id : '', detail: run ? run.detail : '' } : null
    reason = run ? run.detail : ''
  } else if (svc.state === 'degraded') { level = 'red'; text = '出问题了' }
  const rl = runtime.rateLimit
  let upstream429 = false
  let upstreamAuth = false
  if (svc.deploy?.serverLog) {
    try {
      const { tailFile } = await import('./deploy.js')
      const tail = tailFile(svc.deploy.serverLog, 40) || ''
      const text = Array.isArray(tail) ? tail.join('\n') : String(tail)
      upstreamAuth = /Token is invalid|AuthenticationError|\b40[13]\b[^\n]*(Unauthori[sz]ed|Forbidden|token|api.?key)/i.test(text)
      upstream429 = !upstreamAuth && /\b429\b|rate.?limit|Too Many Requests|quota/i.test(text)
    } catch { /* no log */ }
  }
  if (level === 'green' && ((rl && Date.now() - Date.parse(rl.at) < 600000) || upstream429)) {
    level = 'yellow'; text = '模型被限流'
    reason = '会稍后自动重试，要记的内容已排队不会丢；也可以在高级设置里换一个模型'
  }
  const ops = runtime.ops ? runtime.ops.summary() : null
  if (config.enabled && (upstreamAuth || ops?.reason === '密钥无效或已失效') && (level === 'green' || level === 'red')) {
    level = level === 'green' ? 'yellow' : level
    text = '密钥无效或已失效'
    reason = '服务商拒绝了密钥（401/403）：请到服务商网站复制一个有效的密钥，在设置里重新填写'
  }
  if (svc.ready && level === 'green' && runtime.gateway?.down) {
    level = 'yellow'
    text = '模型地址连不上'
    reason = runtime.gateway.reason
  }
  if (ops && svc.ready && level === 'green' && ops.failed > 0) {  // (key errors are reported above)
    level = 'yellow'
    text = `${ops.failed} 段没整理好`
    reason = `${ops.reason || '整理失败'}：会自动重试，也可在状态页点「重试失败项」`
  }
  const banks = [...new Set((runtime.recent || []).map((r) => r.bank).filter(Boolean))]
  const bank = config.bank?.default_bank || banks[0] || ''
  let pending = 0
  if (svc.ready && bank && runtime.client.stats) {
    const st = await Promise.race([runtime.client.stats(bank).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))])
    pending = Number(st?.pending_operations) || 0
  }
  if (ops) pending = Math.max(pending, ops.processing)
  if (runtime.job?.running) pending += Math.max(0, (runtime.job.total || 0) - (runtime.job.done || 0))
  const lastRetain = runtime.activity?.lastRetain || ''
  const lastRecall = runtime.activity?.lastRecall || runtime.lastRecall?.at || ''
  const short = String(reason).split('\n')[0].slice(0, 120)
  let bankName = ''
  for (const w of runtime.workspaces?.values?.() || []) if (w.bankId === bank && w.displayName) { bankName = w.displayName; break }
  const sig = [level, text, short, progress && `${progress.done}/${progress.step}`, bank, bankName, pending, lastRetain, lastRecall].join('|')
  return { level, text, reason: short, progress, bank, bankName, pending, lastRetain, lastRecall, sig }
}
