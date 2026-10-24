import { DEFAULT_CONFIG } from './config.js'
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
import { errorMessage } from './log.js'

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
        recent: runtime.recent.slice(0, 15),
        failures: runtime.failures.slice(0, 15),
        deploy: svc.deployStatus ? await svc.deployStatus().catch(() => null) : null
      }
    },
    async workspaces() {
      return listWorkspaces(ctx)
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
      return runtime.client.listMemories(String(bank), { q: String(q), limit: Math.min(100, Number(limit) || 30), offset: Number(offset) || 0 })
    },
    async presets() {
      // `defaults` = the plugin's built-in values, shown as pre-filled fields in the panel.
      const D = DEFAULT_CONFIG
      const pick = (c) => ({ preset: c.preset, provider: c.provider, base_url: c.base_url, model: c.model })
      return { ...PRESETS, defaults: { embedding: pick(D.embedding), reranker: pick(D.reranker), llm: { ...pick(D.llm), mode: D.llm.mode } } }
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
  if (svc.deploy?.serverLog) {
    try {
      const { tailFile } = await import('./deploy.js')
      const tail = tailFile(svc.deploy.serverLog, 40) || ''
      upstream429 = /\b429\b|rate.?limit|Too Many Requests|quota/i.test(Array.isArray(tail) ? tail.join('\n') : String(tail))
    } catch { /* no log */ }
  }
  if (level === 'green' && ((rl && Date.now() - Date.parse(rl.at) < 600000) || upstream429)) {
    level = 'yellow'; text = '模型被限流'
    reason = '会稍后自动重试，要记的内容已排队不会丢；也可以在高级设置里换一个模型'
  }
  const banks = [...new Set((runtime.recent || []).map((r) => r.bank).filter(Boolean))]
  const bank = config.bank?.default_bank || banks[0] || ''
  let pending = 0
  if (svc.ready && bank && runtime.client.stats) {
    const st = await Promise.race([runtime.client.stats(bank).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))])
    pending = Number(st?.pending_operations) || 0
  }
  if (runtime.job?.running) pending += Math.max(0, (runtime.job.total || 0) - (runtime.job.done || 0))
  const lastRetain = (runtime.recent || [])[0]?.at || ''
  const lastRecall = runtime.lastRecall?.at || ''
  const short = String(reason).split('\n')[0].slice(0, 120)
  const sig = [level, text, short, progress && `${progress.done}/${progress.step}`, bank, pending, lastRetain, lastRecall].join('|')
  return { level, text, reason: short, progress, bank, pending, lastRetain, lastRecall, sig }
}
