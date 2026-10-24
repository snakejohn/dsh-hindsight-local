/**
 * Plugin-root `.env`: the single source of truth for the local Hindsight server's
 * HINDSIGHT_API_* variables.
 *
 * - Generated/updated from the panel config at every runtime generation (panel save →
 *   cordis.patch.yml → loader/volatile-update → new generation → syncDotenv()).
 * - Non-empty panel values overwrite the matching lines; keys the panel leaves empty keep the
 *   value already in `.env`, so hand edits survive and a redacted/blank secret never wipes a key.
 * - The child is spawned with cwd = plugin root: hindsight-api calls
 *   `load_dotenv(find_dotenv(usecwd=True), override=True)` at startup, i.e. a `.env` found by
 *   walking up from cwd OVERRIDES the process env. Using the plugin root makes that file ours
 *   (instead of e.g. a `.env` in the user's workspace J:\AI项目\back), and we also inject the
 *   same values into the child env, so both sources agree.
 * - Written as UTF-8 without BOM, LF; values with spaces/specials are quoted
 *   (single quotes = literal in python-dotenv, so Windows backslashes stay intact).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export const PLUGIN_ROOT = process.env.DSH_HINDSIGHT_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)))
export const DOTENV_PATH = () => join(process.env.DSH_HINDSIGHT_PLUGIN_ROOT || PLUGIN_ROOT, '.env')

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
  try { return existsSync(path) ? parseDotenv(readFileSync(path, 'utf8')) : {} } catch { return {} }
}

const HEADER = 'dsh-hindsight-memory: local Hindsight server settings (HINDSIGHT_API_*) and\n' +
  '「记住哪些内容」 (DSH_HINDSIGHT_RETAIN_*, rewritten from the panel on every save).\n' +
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
    } catch (e) { error = e.message }
  }
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
