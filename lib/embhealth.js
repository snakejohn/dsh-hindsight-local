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
 * Never includes secrets. Empty string when the text is not an embedding error.
 */
export function classifyEmbeddingError(text) {
  const s = String(text || '')
  if (!s.trim()) return null
  if (/20015|does not support.*(dimension|param)|invalid parameter.*dimension|dimensions?\s*(parameter|param|field).*(not|invalid|reject|unsupport)|unsupport.*dimensions?/i.test(s)) {
    return {
      text: '向量模型报错',
      reason: '参数错误（例如误传了 dimensions）',
      hint: '硅基流动的 bge-m3 不要传 dimensions。请检查 ~/.dsh/.env 或系统环境里是否残留 HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS；本插件已会自动丢掉继承来的该变量。'
    }
  }
  if (/\b40[13]\b|token is invalid|invalid.?(api.?)?key|authenticationerror|unauthori[sz]ed|forbidden/i.test(s)) {
    return {
      text: '向量模型报错',
      reason: '密钥无效（401/403）',
      hint: '请到服务商网站复制一个有效的密钥，在设置里重新填写后点「一键开始」。'
    }
  }
  if (/\b429\b|rate.?limit|too many requests|quota/i.test(s)) {
    return {
      text: '向量模型报错',
      reason: '模型被限流（429）',
      hint: '稍后再试，或在高级设置里换一个理解文字的模型。'
    }
  }
  if (/\b400\b|bad request|invalid.?(request|param)|error.?code/i.test(s) && /embed/i.test(s)) {
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

/** Scan recent log lines (already window-filtered) for an embedding failure. */
export function embeddingErrorFromLog(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '')
  return classifyEmbeddingError(text)
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
