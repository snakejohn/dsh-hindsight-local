/**
 * Reachability probe for the extraction LLM resolved from dsh (llm.mode=follow).
 *
 * dsh (notably the Tauri desktop app) can route its default model through a loopback
 * gateway, e.g. `http://127.0.0.1:3425/v1` (cline-pass). Hindsight runs as a separate
 * process; when that relay is down or refusing (ClinePass rate limits show up as
 * "Connection error") extraction fails. The result is only a warning in the panel: the
 * relay usually recovers, and throttling + retries handle it. Only loopback hosts are
 * probed: a remote host may need a proxy the plugin's own fetch does not use, so a failed
 * probe there would not prove Hindsight cannot reach it.
 */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i

export function isLoopbackUrl(url) {
  try {
    return LOOPBACK.test(new URL(String(url)).hostname)
  } catch {
    return false
  }
}

/** @returns {Promise<{ok: boolean, skipped?: boolean, reason?: string}>} any HTTP answer counts as reachable. */
export async function probeLlmReachable(baseUrl, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (!baseUrl || !isLoopbackUrl(baseUrl) || !fetchImpl) return { ok: true, skipped: true }
  const url = String(baseUrl).replace(/\/+$/, '') + '/models'
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    await res.body?.cancel?.().catch?.(() => {})
    return { ok: true }
  } catch (error) {
    const code = error?.cause?.code || error?.code || error?.name || 'error'
    return { ok: false, reason: `模型地址 ${new URL(url).host} 连不上（${code}），请确认对应的程序已启动；连上后会自动继续` }
  }
}
