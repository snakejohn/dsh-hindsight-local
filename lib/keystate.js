/**
 * Per-field API key state for the settings panel. Each channel is judged on its own;
 * the result names only where a key comes from, never the key itself.
 * @module lib/keystate
 */
import { readDotenv, DOTENV_PATH } from './dotenv.js'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'

const PLACEHOLDER = /^(undefined|null|none|false|0|changeme|your[-_ ]?(api[-_ ]?)?key.*|<.*>|\$\{.*\}|sk-(x+|\.+|…|\*+)|x+|\*+|\.+|…|.*（已设置）)$/i

/** A real key: non-empty after trimming and not a placeholder. */
export function isRealKey(v) {
  if (typeof v !== 'string') return false
  const s = v.trim()
  return s.length > 0 && !PLACEHOLDER.test(s)
}

export const CHANNELS = ['embedding', 'reranker', 'llm']
export const ENV_VARS = { embedding: 'DSH_HINDSIGHT_EMBEDDING_API_KEY', reranker: 'DSH_HINDSIGHT_RERANKER_API_KEY', llm: 'DSH_HINDSIGHT_LLM_API_KEY' }

/** The `.env` variable Hindsight reads for this channel's key (provider-specific). */
export function dotenvVar(channel, provider) {
  if (channel === 'llm') return 'HINDSIGHT_API_LLM_API_KEY'
  const p = String(provider || '').trim().toUpperCase()
  if (!p) return ''
  return channel === 'embedding' ? `HINDSIGHT_API_EMBEDDINGS_${p}_API_KEY` : `HINDSIGHT_API_RERANKER_${p}_API_KEY`
}

/**
 * @param {{ inline?: object, env?: object, dotenv?: object, config: object }} o
 *   inline = dsh plugin config as saved (before defaults/sharing), env = process env,
 *   dotenv = parsed plugin .env, config = resolved config (for providers/mode/sharing)
 * @returns {Record<string, {set: boolean, source: 'env'|'plugin-config'|'dotenv'|'dsh'|'shared'|''}>}
 */
export function keyStates({ inline = {}, env = {}, dotenv = {}, config = {} }) {
  const out = {}
  for (const ch of CHANNELS) {
    const sources = []
    if (ch === 'llm' && config.llm?.mode === 'follow') { out[ch] = { set: false, source: 'dsh', sources: ['dsh'] }; continue }
    if (isRealKey(env[ENV_VARS[ch]])) sources.push('env')
    if (isRealKey(dotenv[ENV_VARS[ch]])) sources.push('dotenv')
    if (isRealKey(inline?.[ch]?.api_key)) sources.push('plugin-config')
    const dv = dotenvVar(ch, config[ch]?.provider)
    if (dv && isRealKey(dotenv[dv])) sources.push('dotenv')
    if (sources.length) out[ch] = { set: true, source: sources[0], sources }
    else if (ch !== 'embedding' && isRealKey(config[ch]?.api_key)) out[ch] = { set: false, source: 'shared', sources: [] }
    else out[ch] = { set: false, source: '', sources: [] }
  }
  return out
}

/** Remove every channel key line from the plugin .env. Returns the variable names removed. */
export function clearDotenvKeys(path = DOTENV_PATH()) {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  const removed = []
  const kept = lines.filter((l) => {
    const m = /^\s*(?:export\s+)?(HINDSIGHT_API_(?:EMBEDDINGS|RERANKER)_[A-Z0-9]+_API_KEY|HINDSIGHT_API_LLM_API_KEY|DSH_HINDSIGHT_(?:EMBEDDING_|RERANKER_|LLM_)?API_KEY)\s*=/.exec(l)
    if (m) { removed.push(m[1]); return false }
    return true
  })
  if (removed.length) { writeFileSync(path + '.tmp', kept.join('\n'), { mode: 0o600 }); renameSync(path + '.tmp', path) }
  return removed
}

export { readDotenv }
