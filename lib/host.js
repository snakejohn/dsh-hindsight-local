/**
 * Reads from official dsh services (looked up lazily with ctx.get, all optional):
 * - workspaceRegistry: list() -> Workspace { id, path, title, sessionIds }, archivedSessionIds
 *   (packages/workspace/workspace/src/index.ts). Archiving never removes a session from its
 *   workspace's sessionIds, it only adds it to the registry-global archive set.
 * - agentDefaultModel.currentSelection() -> { provider, model } (packages/core/agent-default-model)
 * - llm.listConfigurableProviders() -> { provider, settingsNs, settingsPath, defaultBaseURL,
 *   baseURLEnv, nativeAuth: { env } } (packages/llm/llm/src/types.ts)
 * - settings.describe() for the provider profile's baseURL / apiKeyEnv reference
 * - credentials.resolve(ref) -> { value, source } (packages/credentials/credentials) — the
 *   documented way to read a key by its reference name; nothing reads credential files.
 */
function svc(ctx, name) {
  try { return ctx?.get?.(name) } catch { return undefined }
}

export function listWorkspaces(ctx) {
  const reg = svc(ctx, 'workspaceRegistry')
  if (!reg?.list) return { available: false, workspaces: [] }
  let archived, raw
  try {
    archived = new Set(reg.archivedSessionIds || [])
    raw = reg.list()
  } catch (error) {
    return { available: false, workspaces: [], reason: String(error?.message || error) }
  }
  const workspaces = raw.map((ws) => {
    const ids = [...(ws.sessionIds || [])]
    const active = ids.filter((id) => !archived.has(id))
    return { id: ws.id, path: ws.path, title: ws.title, sessions: active.length, archived: ids.length - active.length, sessionIds: active }
  })
  return { available: true, workspaces }
}

const at = (obj, path) => (path || []).reduce((v, k) => (v == null ? undefined : v[k]), obj)

/** Map a dsh model route onto Hindsight's LLM provider vocabulary. */
export function toHindsightLlm({ provider, model, baseURL }) {
  let base = String(baseURL || '').replace(/\/+$/, '')
  if (/deepseek/i.test(provider) || /api\.deepseek\.com/.test(base)) {
    // dsh's DeepSeek route speaks the Anthropic-compatible `/anthropic` root; Hindsight's
    // `deepseek` provider wants the OpenAI-compatible API root.
    base = base.replace(/\/anthropic$/, '') || 'https://api.deepseek.com'
    return { provider: 'deepseek', base_url: base, model }
  }
  if (/anthropic|claude/i.test(provider)) return { provider: 'anthropic', base_url: base, model }
  if (/ollama/i.test(provider)) return { provider: 'ollama', base_url: base, model }
  return { provider: 'openai', base_url: base, model }
}

/**
 * Resolve dsh's default model into Hindsight LLM settings.
 * @returns {Promise<{ ok: boolean, reason?: string, llm?: object, keyRef?: string, keySource?: string }>}
 */
export async function resolveDshDefaultLlm(ctx, { env = process.env } = {}) {
  const dm = svc(ctx, 'agentDefaultModel')
  const sel = dm?.currentSelection?.()
  if (!sel?.provider || !sel?.model) return { ok: false, reason: 'dsh has no default model selected' }
  const llm = svc(ctx, 'llm')
  const route = llm?.listConfigurableProviders?.().find((p) => p.provider === sel.provider)
  let baseURL = route?.defaultBaseURL || ''
  for (const name of route?.baseURLEnv || []) if (env[name]) { baseURL = env[name]; break }
  let keyRef = route?.nativeAuth?.env?.[0] || ''
  try {
    const desc = svc(ctx, 'settings')?.describe?.({ redactSecrets: true })?.find((d) => d.ns === route?.settingsNs)
    const prof = at(desc?.value, route?.settingsPath)
    if (prof?.baseURL) baseURL = prof.baseURL
    if (typeof prof?.apiKeyEnv === 'string' && prof.apiKeyEnv) keyRef = prof.apiKeyEnv
    else if (typeof prof?.connection?.apiKeyEnv === 'string') keyRef = prof.connection.apiKeyEnv
  } catch { /* settings optional */ }
  const mapped = toHindsightLlm({ provider: sel.provider, model: sel.model, baseURL })
  let apiKey = ''
  let keySource = ''
  if (keyRef) {
    const creds = svc(ctx, 'credentials')
    try {
      const hit = creds?.resolve ? await creds.resolve(keyRef) : (env[keyRef] ? { value: env[keyRef], source: 'env' } : undefined)
      if (hit?.value) { apiKey = hit.value; keySource = String(hit.source || 'credentials') }
    } catch { /* unresolvable reference */ }
  }
  return {
    ok: !!apiKey,
    reason: apiKey ? undefined : (keyRef ? `key ${keyRef} is not set in dsh` : 'dsh route reports no key reference'),
    dshProvider: sel.provider,
    keyRef,
    keySource,
    llm: { ...mapped, api_key: apiKey }
  }
}
