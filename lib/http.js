/**
 * Tiny fetch wrapper: JSON in, JSON out, hard timeout, abortable.
 * No external dependencies — Node 20+ global fetch is enough.
 */

export class HttpError extends Error {
  constructor(status, bodyText, url, method) {
    const brief = String(bodyText || '').replace(/\s+/g, ' ').slice(0, 300)
    super(`HTTP ${status} ${method} ${url}${brief ? ' -> ' + brief : ''}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
    this.method = method
    this.body = bodyText
  }
}

export function joinUrl(base, path) {
  if (!path) return base
  if (/^https?:\/\//i.test(path)) return path
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}

export async function requestJson(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs)
  const outerSignal = options.signal
  const onAbort = () => controller.abort(outerSignal.reason)
  if (outerSignal) {
    if (outerSignal.aborted) onAbort()
    else outerSignal.addEventListener('abort', onAbort, { once: true })
  }

  const headers = { accept: 'application/json', ...(options.headers || {}) }
  let body
  if (options.body !== undefined) {
    headers['content-type'] = headers['content-type'] || 'application/json'
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  }

  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal })
    const text = await response.text()
    let json = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    if (!response.ok) throw new HttpError(response.status, text, url, method)
    return { status: response.status, json, text, headers: response.headers }
  } catch (error) {
    if (controller.signal.aborted) {
      const cancelledByCaller = Boolean(outerSignal?.aborted)
      const wrapped = new Error(
        `${cancelledByCaller ? 'request cancelled' : 'request timeout'}: ${method} ${url} (${timeoutMs}ms)`
      )
      wrapped.name = cancelledByCaller ? 'AbortError' : 'TimeoutError'
      wrapped.cause = error
      throw wrapped
    }
    throw error
  } finally {
    clearTimeout(timer)
    if (outerSignal) outerSignal.removeEventListener?.('abort', onAbort)
  }
}
