/**
 * Log housekeeping + feedback export.
 * - rotateFile: size-based rotation (file -> file.1 -> ... -> file.N). Rename first; if Windows
 *   refuses because another process holds the file (EPERM/EBUSY), copy then truncate in place.
 *   Rotated copies collapse runs of identical lines (Hindsight retry spam) into one line + count.
 * - cleanupLogs: delete rotated/exported files older than maxAgeDays, then oldest first until
 *   the directory is under totalCapBytes. Live logs are never deleted, only rotated.
 * - redact: strips API keys / tokens / passwords before anything leaves the machine.
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync, fstatSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir, platform, release, arch } from 'node:os'

export const LOG_LIMITS = { maxBytes: 5 * 1024 * 1024, keep: 3, totalCapBytes: 25 * 1024 * 1024, maxAgeDays: 14 }

const SECRET_KEY = '[A-Za-z0-9_.-]*(?:API_?KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTHORIZATION)[A-Za-z0-9_.-]*'
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_\-]{6,}/g, '$1-***')
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=\-]{6,}/gi, '$1 ***')
    .replace(new RegExp(`("?${SECRET_KEY}"?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;&}\\]]+)`, 'gi'), (m, k, v) => k + (/^\(?(已设置|未设置|unset|set)\)?$|^\*+$/.test(v) ? v : '***'))
    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, '$1***')
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***@')
    .replace(/\b(xai|ghp|gho|github_pat|glpat|AIza)[-_A-Za-z0-9]{10,}/g, '$1***')
}

const stamp = /^\s*(\[[^\]]*\]\s*)?\d{4}-\d\d-\d\d[T ][\d:.,]+Z?\s*/
/** Collapse consecutive lines that only differ by their timestamp. */
export function collapseRepeats(text) {
  const out = []
  let last = null, n = 0
  const flush = () => { if (n > 0) out.push(`  …（上一行又重复了 ${n} 次）`); n = 0 }
  for (const line of String(text).split('\n')) {
    const key = line.replace(stamp, '').replace(/\b0x[0-9a-f]+\b|\b\d+(\.\d+)?s\b|attempt \d+\/\d+/gi, '#')
    if (key && key === last) { n++; continue }
    flush(); out.push(line); last = key
  }
  flush()
  return out.join('\n')
}

export function rotateFile(file, { maxBytes = LOG_LIMITS.maxBytes, keep = LOG_LIMITS.keep, force = false } = {}) {
  let size
  try { size = statSync(file).size } catch { return false }
  if (!force && size <= maxBytes) return false
  for (let i = keep - 1; i >= 1; i--) {
    try { if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`) } catch { /* best effort */ }
  }
  try { unlinkSync(`${file}.${keep + 1}`) } catch { /* none */ }
  const dest = `${file}.1`
  try {
    // copy + truncate works while another process (the detached Hindsight child, Windows
    // file locks) keeps the file open in append mode; rename would fail or orphan the handle.
    const body = readFileSync(file, 'utf8')
    writeFileSync(dest, collapseRepeats(body))
    truncateSync(file, 0)
    return true
  } catch {
    try { renameSync(file, dest); return true } catch { try { copyFileSync(file, dest) } catch { /* give up */ } return false }
  }
}

export function cleanupLogs(dir, { maxAgeDays = LOG_LIMITS.maxAgeDays, totalCapBytes = LOG_LIMITS.totalCapBytes, live = [], now = Date.now() } = {}) {
  const removed = []
  let files
  try { files = readdirSync(dir).map((f) => ({ f, p: join(dir, f) })).map((x) => ({ ...x, s: statSync(x.p) })).filter((x) => x.s.isFile()) } catch { return removed }
  const isLive = (f) => live.includes(f) || /\.log$/.test(f) && !/^export-/.test(f)
  const del = (x) => { try { unlinkSync(x.p); removed.push(x.f) } catch { /* locked */ } }
  for (const x of files) if (!isLive(x.f) && now - x.s.mtimeMs > maxAgeDays * 86400000) del(x)
  let rest = files.filter((x) => !removed.includes(x.f))
  let total = rest.reduce((a, x) => a + x.s.size, 0)
  for (const x of rest.filter((x) => !isLive(x.f)).sort((a, b) => a.s.mtimeMs - b.s.mtimeMs)) {
    if (total <= totalCapBytes) break
    del(x); total -= x.s.size
  }
  return removed
}

function tailText(file, maxBytes) {
  try {
    const fd = openSync(file, 'r')
    try {
      const size = fstatSync(fd).size
      const len = Math.min(size, maxBytes)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, size - len)
      return buf.toString('utf8')
    } finally { closeSync(fd) }
  } catch { return '' }
}

/** Build one redacted text file for bug reports; returns its path. */
export function exportLogs({ dir, outDir = dir, files = [], version = '', dshVersion = '', summary = {}, perFileBytes = 400 * 1024, now = new Date() } = {}) {
  mkdirSync(outDir, { recursive: true })
  const parts = [
    `# dsh-hindsight-local 日志导出 ${now.toISOString()}`,
    `插件版本: ${version}`,
    `dsh 版本: ${dshVersion || '未知'}`,
    `系统: ${platform()} ${release()} ${arch()} · Node ${process.version}`,
    '# 设置摘要（密钥已隐藏）',
    redact(JSON.stringify(summary, null, 2))
  ]
  for (const f of files) {
    const p = f.includes('/') || f.includes('\\') ? f : join(dir, f)
    if (!existsSync(p)) continue
    parts.push(`\n# ===== ${basename(p)}（最后 ${Math.round(perFileBytes / 1024)} KB）=====`)
    parts.push(redact(collapseRepeats(tailText(p, perFileBytes))))
  }
  const out = join(outDir, `export-${now.toISOString().replace(/[:.]/g, '-')}.txt`)
  writeFileSync(out, parts.join('\n') + '\n')
  return out
}

export const DEFAULT_LOG_DIR = () => process.env.DSH_HINDSIGHT_LOG_DIR || join(homedir(), '.dsh-hindsight', 'logs')
