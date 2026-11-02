/**
 * Truthful embedding readiness: /health only means the Hindsight process is up.
 * Retain/recall still need a working embedding provider. We probe cheaply (one short
 * vector call), cache the result, and also classify recent server-log / op errors.
 */
import { probeEmbeddingDim } from './dimension.js'

/** Cache TTLs: success lasts longer; failures re-check sooner without spamming the API. */
export const EMB_OK_TTL_MS = 5 * 60 * 1000
export const EMB_FAIL_TTL_MS = 60 * 1000

/**
 * Classify an embedding /provider error into a short Chinese reason + hint.
 * Never includes secrets. Null when the text is not an embedding error.
 *
 * Default (loose) mode is for text we know is an error, e.g. the plugin's own probe
 * response. `{ strict: true }` is for server-log lines: bare numbers like 401/403/429
 * appear everywhere in a log (timestamp milliseconds `16:52:35,403`, `thoughts_tokens=401`,
 * task ids…), so status codes only count with context (Error code / HTTP / status, or
 * next to Unauthorized / Forbidden / invalid key / rate limit).
 */
export function classifyEmbeddingError(text, { strict = false } = {}) {
  const s = String(text || '')
  if (!s.trim()) return null
  const CTX = String.raw`(?:error[ _]?code|http(?:\s*status)?|status(?:[ _]?code)?|code)['"]?\s*[:=]?\s*['"]?`
  const dimRe = /does not support.*(dimension|param)|invalid parameter.*dimension|dimensions?\s*(parameter|param|field).*(not|invalid|reject|unsupport)|unsupport.*dimensions?/i
  const is20015 = strict
    ? new RegExp(`${CTX}20015\\b`, 'i').test(s) || /\b20015\b[^\n]*(param|dimension)/i.test(s)
    : /20015/.test(s)
  if (is20015 || dimRe.test(s)) {
    return {
      text: '向量模型报错',
      reason: '参数错误（例如误传了 dimensions）',
      hint: '硅基流动的 bge-m3 不要传 dimensions。请检查 ~/.dsh/.env 或系统环境里是否残留 HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS；本插件已会自动丢掉继承来的该变量。'
    }
  }
  const authWords = /token is invalid|invalid.?(api.?)?(key|token)|authenticationerror|permissiondeniederror|unauthori[sz]ed|forbidden/i
  const isAuth = strict
    ? authWords.test(s) || new RegExp(`${CTX}40[13]\\b`, 'i').test(s) ||
      /\b40[13]\b[^\n]{0,80}(unauthori|forbidden|invalid|api.?key|token)/i.test(s)
    : /\b40[13]\b/.test(s) || authWords.test(s)
  if (isAuth) {
    return {
      text: '向量模型报错',
      reason: '密钥无效（401/403）',
      hint: '请到服务商网站复制一个有效的密钥，在设置里重新填写后点「一键开始」。'
    }
  }
  const rlWords = /rate.?limit|too many requests|quota/i
  const is429 = strict
    ? rlWords.test(s) || new RegExp(`${CTX}429\\b`, 'i').test(s)
    : /\b429\b/.test(s) || rlWords.test(s)
  if (is429) {
    return {
      text: '向量模型报错',
      reason: '模型被限流（429）',
      hint: '稍后再试，或在高级设置里换一个理解文字的模型。'
    }
  }
  const is400 = strict
    ? new RegExp(`${CTX}400\\b`, 'i').test(s) || /bad request|invalid.?(request|param)/i.test(s)
    : /\b400\b|bad request|invalid.?(request|param)|error.?code/i.test(s)
  if (is400 && /embed/i.test(s)) {
    return {
      text: '向量模型报错',
      reason: '服务商返回 400 参数错误',
      hint: '请检查理解文字的模型名和接口地址是否匹配；bge-m3 不要传 dimensions。'
    }
  }
  if (/embed(ding)?.*(fail|error|exception)|Error.*(embed|vector)|sentence-transformers|LocalSTEmbeddings/i.test(s)) {
    return {
      text: '向量模型报错',
      reason: '向量模型调用失败',
      hint: '请查看记忆服务日志（hindsight.log），检查密钥、模型和网络。'
    }
  }
  return null
}

const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,.]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*(?:-\s*)?/
const LEVEL_RE = /^(DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|CRITICAL|FATAL)\b\s*:?\s*(?:-\s*)?/i
const BAD_LEVEL = /^(WARNING|WARN|ERROR|CRITICAL|FATAL)$/i
const EXC_LINE = /^\s*[|>]*\s*(Traceback\b|[\w.]*(Error|Exception)\b\s*:|raise\b)/

/**
 * Keep only error-ish server-log lines, with the timestamp (and level) stripped:
 * WARNING / ERROR / CRITICAL lines, plus their continuation lines (tracebacks).
 * INFO/DEBUG lines and their continuations are dropped — their numbers are noise.
 * Continuation lines at the very start of the window (header cut off) count only
 * when they look like an exception (`Traceback`, `openai.AuthenticationError: …`).
 */
export function errorLogLines(lines) {
  const arr = Array.isArray(lines) ? lines : String(lines || '').split('\n')
  const out = []
  let state = null // null = unknown, true = inside an error entry, false = inside an info entry
  for (const raw of arr) {
    const line = String(raw || '')
    if (!line.trim()) continue
    const hasTs = TS_RE.test(line)
    let body = hasTs ? line.replace(TS_RE, '') : line
    const lv = LEVEL_RE.exec(body)
    if (hasTs || lv) {
      if (lv) {
        state = BAD_LEVEL.test(lv[1])
        body = body.slice(lv[0].length)
      } else {
        state = false
      }
      if (state) out.push(body)
      continue
    }
    if (/^\s*Traceback\b/.test(line)) { state = true; out.push(line.trim()); continue }
    if (state === true || (state === null && EXC_LINE.test(line))) out.push(line.trim())
  }
  return out
}

/**
 * Pick the most specific classification across error lines (per line, so one line's
 * "400" never combines with another line's "embed").
 */
function classifyLines(errLines) {
  const order = ['参数错误（例如误传了 dimensions）', '密钥无效（401/403）', '模型被限流（429）', '服务商返回 400 参数错误', '向量模型调用失败']
  let best = null
  for (const l of errLines) {
    const c = classifyEmbeddingError(l, { strict: true })
    if (c && (!best || order.indexOf(c.reason) < order.indexOf(best.reason))) best = c
  }
  return best
}

/** Scan recent log lines (already window-filtered) for an embedding failure. */
export function embeddingErrorFromLog(lines) {
  return classifyLines(errorLogLines(lines))
}

/**
 * Upstream signals from recent server-log lines (strict, error lines only):
 * auth = a provider rejected a key (401/403); rateLimit = 429 / rate limit.
 */
export function upstreamFromLog(lines) {
  const errs = errorLogLines(lines)
  let auth = false
  let rateLimit = false
  for (const l of errs) {
    const c = classifyEmbeddingError(l, { strict: true })
    if (c?.reason === '密钥无效（401/403）') auth = true
    else if (c?.reason === '模型被限流（429）') rateLimit = true
  }
  return { auth, rateLimit: !auth && rateLimit, emb: classifyLines(errs) }
}

/**
 * One cheap /embeddings call using the plugin's own config (never inherited DIMENSIONS).
 * @returns {Promise<{ ok: boolean, reason?: string, hint?: string, status?: number, at: string }>}
 */
export async function probeEmbeddingHealth({
  provider, baseUrl, apiKey, model, dimensions, fetchImpl = fetch, timeoutMs = 12000
} = {}) {
  const at = new Date().toISOString()
  if (String(provider || '').toLowerCase() !== 'openai' || !baseUrl || !model) {
    return { ok: true, at, skipped: true }
  }
  // Never send dimensions unless the panel explicitly set a positive value — bge-m3 rejects it.
  const dim = Number(dimensions) > 0 ? Number(dimensions) : undefined
  const p = await probeEmbeddingDim({
    provider, baseUrl, apiKey, model, dimensions: dim, fetchImpl, timeoutMs
  })
  if (p.dim) return { ok: true, at, dim: p.dim }
  const classified = classifyEmbeddingError(`${p.reason || ''} ${p.body || ''} HTTP ${p.status || ''}`)
  if (classified) {
    return { ok: false, at, status: p.status, reason: classified.reason, hint: classified.hint, text: classified.text }
  }
  if (p.reason === 'unsupported') return { ok: true, at, skipped: true }
  return {
    ok: false,
    at,
    status: p.status,
    text: '向量模型报错',
    reason: p.reason || '探测失败',
    hint: '请检查理解文字的模型密钥、地址和网络。'
  }
}

/**
 * Cached probe so the sidebar long-poll and readiness checks do not spam the API.
 */
export function createEmbHealthCache({
  ttlOk = EMB_OK_TTL_MS,
  ttlFail = EMB_FAIL_TTL_MS,
  probe = probeEmbeddingHealth,
  now = () => Date.now()
} = {}) {
  let cached = null
  let inflight = null
  return {
    get() { return cached },
    /** Force the next ensure() to re-probe. */
    invalidate() { cached = null },
    async ensure(args, { force = false } = {}) {
      const t = now()
      if (!force && cached) {
        const ttl = cached.ok ? ttlOk : ttlFail
        if (t - (cached._t || 0) < ttl) return cached
      }
      if (inflight) return inflight
      inflight = Promise.resolve()
        .then(() => probe(args))
        .then((r) => {
          cached = { ...r, _t: now() }
          return cached
        })
        .finally(() => { inflight = null })
      return inflight
    }
  }
}
