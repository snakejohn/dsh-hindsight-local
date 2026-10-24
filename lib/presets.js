/**
 * Provider presets for the settings panel: picking one fills `provider` (the value Hindsight
 * understands), `base_url` and a suggested `model`. Many vendors are OpenAI-compatible, so
 * their preset maps to Hindsight's `openai` provider with the vendor's base URL.
 * URLs are each vendor's documented public API root (checked 2026-10).
 */
export const PRESETS = {
  embedding: {
    openai: { provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'text-embedding-3-small', models: 'openai' },
    siliconflow: { provider: 'openai', base_url: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', models: 'openai' },
    jina: { provider: 'openai', base_url: 'https://api.jina.ai/v1', model: 'jina-embeddings-v3', models: 'none' },
    voyage: { provider: 'openai', base_url: 'https://api.voyageai.com/v1', model: 'voyage-3.5', models: 'none' },
    dashscope: { provider: 'openai', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v4', models: 'openai' },
    openrouter: { provider: 'openrouter', base_url: 'https://openrouter.ai/api/v1', model: '', models: 'openai' },
    cohere: { provider: 'cohere', base_url: 'https://api.cohere.com', model: 'embed-multilingual-v3.0', models: 'cohere' },
    ollama: { provider: 'openai', base_url: 'http://localhost:11434/v1', model: 'nomic-embed-text', models: 'ollama' },
    tei: { provider: 'tei', base_url: 'http://localhost:8080', model: '', models: 'none' },
    local: { provider: 'local', base_url: '', model: '', models: 'none' }
  },
  reranker: {
    rrf: { provider: 'rrf', base_url: '', model: '', models: 'none' },
    siliconflow: { provider: 'siliconflow', base_url: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-reranker-v2-m3', models: 'openai' },
    cohere: { provider: 'cohere', base_url: 'https://api.cohere.com', model: 'rerank-multilingual-v3.0', models: 'cohere' },
    alibaba: { provider: 'alibaba', base_url: 'https://dashscope.aliyuncs.com/api/v1', model: 'gte-rerank-v2', models: 'none' },
    zeroentropy: { provider: 'zeroentropy', base_url: 'https://api.zeroentropy.dev/v1', model: 'zerank-1', models: 'none' },
    tei: { provider: 'tei', base_url: 'http://localhost:8080', model: '', models: 'none' },
    local: { provider: 'local', base_url: '', model: '', models: 'none' }
  },
  llm: {
    deepseek: { provider: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat', models: 'openai' },
    openai: { provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', models: 'openai' },
    siliconflow: { provider: 'openai', base_url: 'https://api.siliconflow.cn/v1', model: 'XingChenAGI/Xing4.0-29B', models: 'openai' },
    dashscope: { provider: 'openai', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: 'openai' },
    openrouter: { provider: 'openai', base_url: 'https://openrouter.ai/api/v1', model: '', models: 'openai' },
    anthropic: { provider: 'anthropic', base_url: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest', models: 'anthropic' },
    gemini: { provider: 'gemini', base_url: '', model: 'gemini-2.0-flash', models: 'none' },
    groq: { provider: 'groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', models: 'openai' },
    ollama: { provider: 'ollama', base_url: 'http://localhost:11434/v1', model: 'qwen2.5:7b', models: 'ollama' },
    lmstudio: { provider: 'lmstudio', base_url: 'http://localhost:1234/v1', model: '', models: 'openai' }
  }
}

/** Which model-listing dialect a provider/base URL speaks. */
export function listingKind(channel, preset, provider, baseUrl) {
  const p = PRESETS[channel]?.[preset]
  if (p) return p.models
  if (/11434/.test(baseUrl || '')) return 'ollama'
  if (provider === 'cohere') return 'cohere'
  if (provider === 'anthropic') return 'anthropic'
  return baseUrl ? 'openai' : 'none'
}

/**
 * Fetch the model ids an endpoint serves. Runs on the plugin (server) side only, so the key
 * never reaches the browser and CORS does not apply.
 */
export async function fetchModels({ kind, baseUrl, apiKey, channel, fetchImpl = fetch, timeoutMs = 8000 }) {
  if (kind === 'none' || !baseUrl) return { models: [], note: 'listing not supported for this provider' }
  const root = String(baseUrl).replace(/\/+$/, '')
  let url
  const headers = { accept: 'application/json' }
  if (kind === 'ollama') url = root.replace(/\/v1$/, '') + '/api/tags'
  else if (kind === 'cohere') {
    url = `${root}/v1/models?page_size=200${channel === 'embedding' ? '&endpoint=embed' : channel === 'reranker' ? '&endpoint=rerank' : ''}`
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
  } else if (kind === 'anthropic') {
    url = `${root}/v1/models`
    if (apiKey) { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01' }
  } else {
    url = `${root}/models`
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
  }
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  if (!res.ok) throw new Error(`GET ${url.replace(/\?.*/, '')} -> HTTP ${res.status}`)
  const body = await res.json()
  const raw = body.data || body.models || []
  let ids = raw.map((m) => m.id || m.name || m.model).filter(Boolean)
  // Rank ids that look right for the channel first; keep everything so the user can pick.
  const hint = channel === 'embedding' ? /embed|bge-m3|e5|gte/i : channel === 'reranker' ? /rerank/i : null
  if (hint) ids = [...ids.filter((id) => hint.test(id)), ...ids.filter((id) => !hint.test(id))]
  return { models: [...new Set(ids)] }
}
