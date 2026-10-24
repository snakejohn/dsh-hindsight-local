/**
 * Crash-safe small-file writes: write a unique temp file in the same directory, fsync, then
 * rename over the target. A kill -9 at any point leaves either the old or the new content,
 * never a half-written JSON. Windows: rename onto an existing file can fail transiently with
 * EPERM/EBUSY/EACCES (antivirus, indexer) -> short retries, then a direct write as last resort.
 */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'

export function writeFileAtomic(file, data, { mode } = {}) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`
  const fd = openSync(tmp, 'w', mode)
  try {
    writeSync(fd, typeof data === 'string' ? data : String(data))
    try { fsyncSync(fd) } catch { /* not supported on some filesystems */ }
  } finally {
    closeSync(fd)
  }
  let lastError
  for (let i = 0; i < 5; i++) {
    try { renameSync(tmp, file); return } catch (error) {
      lastError = error
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) break
      const until = Date.now() + 20 * (i + 1)
      while (Date.now() < until) { /* brief spin: sync callers, tiny files */ }
    }
  }
  try { unlinkSync(tmp) } catch { /* ignore */ }
  throw lastError
}
