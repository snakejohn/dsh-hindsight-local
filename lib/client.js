/**
 * Hindsight REST client (api_version 1.1.0).
 *
 * Endpoints used by this plugin (bank-scoped prefix defaults to `/v1/default`):
 *   GET    /health                                      -> {"status":"healthy", ...}
 *   GET    /version                                     -> {"api_version":"1.1.0", ...}
 *   GET    /v1/default/banks                            -> {"banks":[...]}
 *   PUT    /v1/default/banks/{bank}                     -> CreateBankRequest (idempotent upsert)
 *   GET    /v1/default/banks/{bank}/config              -> {"config":{...}}
 *   PATCH  /v1/default/banks/{bank}/config              -> {"updates":{...}}
 *   POST   /v1/default/banks/{bank}/memories            -> RetainRequest {items, async}
 *   POST   /v1/default/banks/{bank}/memories/recall     -> RecallRequest {query, budget, max_tokens, ...}
 *   GET    /v1/default/banks/{bank}/stats
 *
 * Every method is a thin, side-effect-free HTTP call: retries, fallbacks and
 * degradation live in the caller so the transport stays predictable.
 */
import { HttpError, joinUrl, requestJson } from './http.js'

export class HindsightClient {
  constructor({
    baseUrl,
    apiPrefix = '/v1/default',
    apiKey = '',
    timeoutMs = 8000,
    healthPath = '/health',
    versionPath = '/version',
    ensureCacheMs = 300000,
    logger = null
  }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '')
    this.apiPrefix = '/' + String(apiPrefix || 'v1/default').replace(/^\/+/, '')
    this.apiKey = apiKey || ''
    this.timeoutMs = timeoutMs
    this.healthPath = '/' + String(healthPath || 'health').replace(/^\/+/, '')
    this.versionPath = '/' + String(versionPath || 'version').replace(/^\/+/, '')
    // Bank upserts are cached for a while (not forever): a server-side bank deletion must
    // become recoverable, otherwise retain/recall would 404 until the process restarts.
    this.ensureCacheMs = Number(ensureCacheMs) > 0 ? Number(ensureCacheMs) : 0
    this.ensuredBanks = new Map()
    this.logger = logger
  }

  get banksRoot() {
    return joinUrl(this.baseUrl, `${this.apiPrefix}/banks`)
  }

  bankPath(bankId, suffix = '') {
    return joinUrl(this.banksRoot, `${encodeURIComponent(bankId)}${suffix}`)
  }

  headers(extra = {}) {
    const headers = { ...extra }
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
    return headers
  }

  call(url, { method = 'GET', body, timeoutMs, signal } = {}) {
    return requestJson(url, {
      method,
      body,
      headers: this.headers(),
      timeoutMs: timeoutMs || this.timeoutMs,
      signal
    })
  }

  async health({ timeoutMs } = {}) {
    const started = Date.now()
    try {
      const res = await requestJson(joinUrl(this.baseUrl, this.healthPath), {
        timeoutMs: timeoutMs || this.timeoutMs
      })
      // A reachable-but-broken server (5xx) is not healthy: treat only 2xx as ready.
      const healthy = res.status >= 200 && res.status < 300
      return {
        ok: healthy,
        status: res.status,
        body: res.json,
        error: healthy ? undefined : `health returned ${res.status}`,
        elapsedMs: Date.now() - started
      }
    } catch (error) {
      return {
        ok: false,
        status: error instanceof HttpError ? error.status : 0,
        error: error?.message || String(error),
        elapsedMs: Date.now() - started
      }
    }
  }

  async version({ timeoutMs } = {}) {
    try {
      const res = await this.call(joinUrl(this.baseUrl, this.versionPath), { timeoutMs })
      return res.json || {}
    } catch (error) {
      this.logger?.debug?.(`version probe failed: ${error?.message || error}`)
      return {}
    }
  }

  async listBanks() {
    const res = await this.call(this.banksRoot)
    return res.json?.banks || []
  }

  /**
   * Idempotent bank upsert. A fresh Hindsight install 404s every bank-scoped call
   * until the bank exists, so this runs before the first read and the first write.
   */
  async ensureBank(bankId, { mission = '', background = '', force = false } = {}) {
    const cachedAt = this.ensuredBanks.get(bankId)
    if (!force && cachedAt !== undefined && Date.now() - cachedAt < this.ensureCacheMs) {
      return { bankId, created: false, cached: true }
    }
    const payload = {}
    if (mission) payload.mission = mission
    if (background) payload.background = background
    try {
      const res = await this.call(this.bankPath(bankId), { method: 'PUT', body: payload })
      this.ensuredBanks.set(bankId, Date.now())
      return { bankId, created: true, body: res.json || null }
    } catch (error) {
      // 409 = already exists on servers that do not implement upsert semantics.
      if (error instanceof HttpError && (error.status === 409 || error.status === 200)) {
        this.ensuredBanks.set(bankId, Date.now())
        return { bankId, created: false }
      }
      throw error
    }
  }

  async bankConfig(bankId) {
    const res = await this.call(this.bankPath(bankId, '/config'))
    return res.json?.config || res.json || null
  }

  async patchBankConfig(bankId, updates) {
    const res = await this.call(this.bankPath(bankId, '/config'), { method: 'PATCH', body: { updates } })
    return res.json || null
  }

  async stats(bankId) {
    const res = await this.call(this.bankPath(bankId, '/stats'))
    return res.json || null
  }

  /** GET /banks/{id}/memories/list — browse/search stored memories (status page). */
  async listMemories(bankId, { q = '', limit = 50, offset = 0, type = '' } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (q) params.set('q', q)
    if (type) params.set('type', type)
    const res = await this.call(this.bankPath(bankId, `/memories/list?${params}`))
    return res.json || { items: [] }
  }

  /**
   * @param {string} bankId
   * @param {Array<{content:string, context?:string, tags?:string[], document_id?:string, timestamp?:string, metadata?:object}>} items
   */
  async retain(bankId, items, { async = true, timeoutMs, signal, operationId } = {}) {
    if (!items.length) return { success: true, skipped: true, items_count: 0 }
    const body = { items, async: async !== false }
    if (operationId) body.operation_id = operationId
    const res = await this.call(this.bankPath(bankId, '/memories'), {
      method: 'POST',
      body,
      timeoutMs,
      signal
    })
    return res.json || {}
  }

  /** @param {object} request RecallRequest */
  async recall(bankId, request, { timeoutMs, signal, force = false } = {}) {
    if (force) this.ensuredBanks.delete(bankId)
    const res = await this.call(this.bankPath(bankId, '/memories/recall'), {
      method: 'POST',
      body: request,
      timeoutMs,
      signal
    })
    return res.json || { results: [] }
  }
}
