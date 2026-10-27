/**
 * Isolate the Hindsight child from the parent (dsh) process environment.
 *
 * dsh loads `~/.dsh/.env` into its own process env; Cordis then starts the plugin in that
 * same process, so a leftover HINDSIGHT_API_* from an old daemon-based setup (e.g.
 * HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS=1024) would otherwise be inherited by the
 * child. Hindsight forwards a set `dimensions` into the /embeddings body; SiliconFlow
 * BAAI/bge-m3 rejects that with 400 code 20015, and every retain/recall fails while
 * /health still looks fine.
 *
 * We drop every inherited Hindsight-related variable, then layer on only the values the
 * plugin derives from its own config and .env. PATH / proxy / HOME redirection stay.
 */
/** Names that must not leak from the parent into the Hindsight child. */
export function isInheritedHindsightVar(name) {
  const k = String(name || '')
  return /^(HINDSIGHT_|DSH_HINDSIGHT_)/i.test(k)
}

/**
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} env
 * @returns {{ env: Record<string,string>, dropped: string[] }}
 */
export function stripInheritedHindsight(env) {
  const out = {}
  const dropped = []
  for (const [k, v] of Object.entries(env || {})) {
    if (isInheritedHindsightVar(k)) {
      dropped.push(k)
      continue
    }
    if (v !== undefined) out[k] = v
  }
  dropped.sort()
  return { env: out, dropped }
}

/** Provider-specific DIMENSIONS keys Hindsight may forward as `dimensions` in /embeddings. */
export const EMBEDDING_DIMENSION_KEYS = [
  'HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS',
  'HINDSIGHT_API_EMBEDDINGS_COHERE_OUTPUT_DIMENSIONS',
  'HINDSIGHT_API_EMBEDDINGS_LITELLM_DIMENSIONS',
  'HINDSIGHT_API_EMBEDDINGS_NVIDIA_DIMENSIONS',
  'HINDSIGHT_API_EMBEDDINGS_ONNX_DIMENSIONS'
]

/**
 * When the panel leaves embedding.dimensions empty (0), do not send `dimensions` at all —
 * SiliconFlow bge-m3 rejects it. Also drop stale DIMENSIONS lines left in the plugin .env
 * from an old setup, so load_dotenv(override=True) cannot reintroduce them.
 */
export function scrubUnsetDimensions(fileEnv, generated) {
  const next = { ...(fileEnv || {}) }
  const cleared = []
  for (const k of EMBEDDING_DIMENSION_KEYS) {
    const set = generated && generated[k] !== undefined && generated[k] !== null && String(generated[k]).trim() !== ''
    if (!set && k in next) {
      delete next[k]
      cleared.push(k)
    }
  }
  return { env: next, cleared }
}
