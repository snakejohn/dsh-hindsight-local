/**
 * Plugin-root `.env`: the single source of truth for the local Hindsight server's
 * HINDSIGHT_API_* variables.
 *
 * - Generated/updated from the panel config at every runtime generation (panel save →
 *   cordis.patch.yml → loader/volatile-update → new generation → syncDotenv()).
 * - Non-empty panel values overwrite the matching lines; keys the panel leaves empty keep the
 *   value already in `.env`, so hand edits survive and a redacted/blank secret never wipes a key.
 * - hindsight-api calls `load_dotenv(find_dotenv(usecwd=True), override=True)` at startup, i.e.
 *   a `.env` found by walking up from cwd OVERRIDES the process env. The child runs in
 *   <data root>/run (never inside the plugin dir: on Windows its cwd would lock the dir and block
 *   plugin updates) with a copy of this file there, so the `.env` it finds is ours (not e.g. one
 *   in the user's workspace J:\AI项目\back); the same values are also injected into its env.
 * - Written as UTF-8 without BOM, LF; values with spaces/specials are quoted
 *   (single quotes = literal in python-dotenv, so Windows backslashes stay intact).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { scrubUnsetDimensions } from './childenv.js'

export const PLUGIN_ROOT = process.env.DSH_HINDSIGHT_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)))
export const DOTENV_PATH = () => join(process.env.DSH_HINDSIGHT_PLUGIN_ROOT || PLUGIN_ROOT, '.env')

/**
 * Durable copy of the plugin .env outside the package directory. Reinstalling from GitHub
 * (remove + add in the plugin manager) or a tarball replaces the package directory and deletes
 * its .env; since keys are no longer kept in cordis.patch.yml, that would silently lose them.
 * Every write of the plugin .env is mirrored here, and a missing plugin .env is restored from it.
 */
export const BACKUP_PATH = () => process.env.DSH_HINDSIGHT_ENV_BACKUP || join(homedir(), '.dsh-hindsight', 'plugin.env')

const isPluginDotenv = (path) => path === DOTENV_PATH()

/** Mirror the plugin .env into BACKUP_PATH (best effort). */
export function backupDotenv(path = DOTENV_PATH()) {
  if (!isPluginDotenv(path)) return false
  try {
    const b = BACKUP_PATH()
    mkdirSync(dirname(b), { recursive: true })
    writeFileSync(b + '.tmp', readFileSync(path), { mode: 0o600 })
    renameSync(b + '.tmp', b)
    return true
  } catch { return false }
}

/** Restore a missing plugin .env from BACKUP_PATH. Returns true when it was restored. */
export function restoreDotenv(path = DOTENV_PATH()) {
  if (!isPluginDotenv(path) || existsSync(path)) return false
  try {
    const b = BACKUP_PATH()
    if (!existsSync(b)) return false
    writeFileSync(path + '.tmp', readFileSync(b), { mode: 0o600 })
    renameSync(path + '.tmp', path)
    return true
  } catch { return false }
}

export function parseDotenv(text) {
  const out = {}
  for (let raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    raw = raw.trim()
    if (!raw || raw.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(raw)
    if (!m) continue
    let v = m[2]
    if (v.startsWith("'")) v = v.slice(1, v.lastIndexOf("'") > 0 ? v.lastIndexOf("'") : undefined)
    else if (v.startsWith('"')) {
      const end = v.lastIndexOf('"')
      v = v.slice(1, end > 0 ? end : undefined).replace(/\\(["\\nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c)
    } else v = v.replace(/\s+#.*$/, '').trim()
    out[m[1]] = v
  }
  return out
}

export function quoteValue(v) {
  const s = String(v)
  if (/^[A-Za-z0-9_./:@+,=%-]*$/.test(s)) return s
  if (!s.includes("'") && !/[\r\n]/.test(s)) return `'${s}'`
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}

export function serializeDotenv(env, header = '') {
  const lines = header ? header.split('\n').map((l) => `# ${l}`) : []
  for (const k of Object.keys(env).sort()) if (env[k] !== undefined && env[k] !== null) lines.push(`${k}=${quoteValue(env[k])}`)
  return lines.join('\n') + '\n'
}

export function readDotenv(path = DOTENV_PATH()) {
  restoreDotenv(path)
  try { return existsSync(path) ? parseDotenv(readFileSync(path, 'utf8')) : {} } catch { return {} }
}

const HEADER = 'dsh-hindsight-memory: local Hindsight server settings (HINDSIGHT_API_*) and\n' +
  '「记住哪些内容」 (DSH_HINDSIGHT_RETAIN_*, rewritten from the panel on every save) and the API\n' +
  'keys (DSH_HINDSIGHT_*_API_KEY; keys are kept only here, not in dsh\'s cordis.patch.yml;\n' +
  'a copy is kept in ~/.dsh-hindsight/plugin.env so reinstalling the plugin does not lose them).\n' +
  'Generated from the settings panel; non-empty panel values overwrite lines here, empty panel\n' +
  'fields keep what is in this file, so you may also edit it by hand. Keep it private (contains keys).'

/**
 * Merge generated values into `.env` and return the effective variables.
 * @param {Record<string,string>} generated HINDSIGHT_* values derived from the panel config
 * @param {{ path?: string, transient?: Record<string,string> }} options transient values (e.g.
 *   a key resolved from dsh credentials in follow mode) are applied to the result but never
 *   written to disk.
 */
export function syncDotenv(generated, { path = DOTENV_PATH(), transient = {} } = {}) {
  const existing = readDotenv(path)
  const next = { ...existing }
  for (const [k, v] of Object.entries(generated)) {
    if (!/^(HINDSIGHT_|UV_|HF_|DSH_HINDSIGHT_EMBEDDING_DIM$|DSH_HINDSIGHT_RETAIN_)/.test(k)) continue
    if (v === undefined || v === null || v === '') continue
    if (k in transient) continue
    next[k] = String(v)
  }
  // Drop stale DIMENSIONS lines when the panel leaves embedding.dimensions empty (bge-m3
  // rejects `dimensions` in the request). Otherwise load_dotenv(override=True) in the child
  // would reintroduce a leftover value from an old daemon-based .env.
  const scrubbed = scrubUnsetDimensions(next, generated)
  Object.keys(next).forEach((k) => { if (!(k in scrubbed.env)) delete next[k] })
  let written = false
  let error = ''
  const text = serializeDotenv(next, HEADER)
  let before = ''
  try { before = existsSync(path) ? readFileSync(path, 'utf8') : '' } catch { /* rewrite */ }
  if (text !== before) {
    try {
      // UTF-8 without BOM (Buffer.from never adds one); atomic replace.
      writeFileSync(path + '.tmp', Buffer.from(text, 'utf8'), { mode: 0o600 })
      renameSync(path + '.tmp', path)
      written = true
      backupDotenv(path)
    } catch (e) { error = e.message }
  } else if (existsSync(path) && !existsSync(BACKUP_PATH())) backupDotenv(path)
  const effective = { ...next }
  for (const [k, v] of Object.entries(transient)) if (v) effective[k] = String(v)
  return { path, env: effective, file: next, written, error }
}

export function maskedDotenv(path = DOTENV_PATH()) {
  const env = readDotenv(path)
  const out = {}
  for (const [k, v] of Object.entries(env)) out[k] = /KEY|TOKEN|SECRET|PASSWORD/.test(k) ? (v ? `${v.slice(0, 3)}…${v.slice(-2)}（已设置）` : '') : v
  return { path, exists: existsSync(path), env: out }
}

/** API keys live only here (never in dsh's cordis.patch.yml): panel path -> .env variable. */
export const KEY_VARS = {
  'embedding.api_key': 'DSH_HINDSIGHT_EMBEDDING_API_KEY',
  'reranker.api_key': 'DSH_HINDSIGHT_RERANKER_API_KEY',
  'llm.api_key': 'DSH_HINDSIGHT_LLM_API_KEY',
  'service.api_key': 'DSH_HINDSIGHT_API_KEY'
}

/** The DSH_HINDSIGHT_*_API_KEY lines of the plugin .env (fed into resolveConfig as env). */
export function dotenvKeyEnv(path = DOTENV_PATH()) {
  const env = readDotenv(path)
  const out = {}
  for (const v of Object.values(KEY_VARS)) if (typeof env[v] === 'string' && env[v].trim()) out[v] = env[v].trim()
  return out
}

/**
 * Write API keys into the plugin .env.
 * @param {Record<string,string>} keys panel path ('embedding.api_key', ...) -> key; empty values are skipped
 * @param {{ path?: string, overwrite?: boolean }} o overwrite=false keeps a key already in .env
 * @returns {{ written: string[], error: string }} the .env variable names written (never the values)
 */
export function writeDotenvKeys(keys, { path = DOTENV_PATH(), overwrite = true } = {}) {
  const existing = readDotenv(path)
  const next = { ...existing }
  const written = []
  for (const [p, v] of Object.entries(keys || {})) {
    const name = KEY_VARS[p]
    const val = typeof v === 'string' ? v.trim() : ''
    if (!name || !val || /[\r\n]/.test(val)) continue
    if (!overwrite && existing[name]) continue
    if (existing[name] === val) continue
    next[name] = val
    written.push(name)
  }
  if (!written.length) return { written, error: '' }
  try {
    writeFileSync(path + '.tmp', Buffer.from(serializeDotenv(next, HEADER), 'utf8'), { mode: 0o600 })
    renameSync(path + '.tmp', path)
    backupDotenv(path)
    return { written, error: '' }
  } catch (e) { return { written: [], error: e.message } }
}

/** Keys found in the inline (cordis.patch.yml) plugin config, by panel path. */
export function inlineKeys(raw = {}) {
  const out = {}
  for (const p of Object.keys(KEY_VARS)) {
    const [a, b] = p.split('.')
    const v = raw?.[a]?.[b]
    if (typeof v === 'string' && v.trim()) out[p] = v.trim()
  }
  return out
}
