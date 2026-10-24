/**
 * Minimal, dependency-free logger.
 *
 * Writes to a rotating file (default `~/.dsh-hindsight/plugin.log`) and, when the
 * Cordis context exposes a logger service, mirrors into the DSH log as well.
 * Every filesystem operation is best-effort: logging must never break a turn.
 */
import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { rotateFile, LOG_LIMITS, redact } from './logfiles.js'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }
const MAX_BYTES = LOG_LIMITS.maxBytes

export function defaultLogFile() {
  return join(homedir(), '.dsh-hindsight', 'plugin.log')
}

function jsonable(value) {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v))
  } catch {
    return String(value)
  }
}

let lastCheck = 0
function rotateIfNeeded(file) {
  const now = Date.now()
  if (now - lastCheck < 5000) return
  lastCheck = now
  try {
    if (statSync(file).size > MAX_BYTES) rotateFile(file, { maxBytes: MAX_BYTES, keep: LOG_LIMITS.keep })
  } catch {
    /* first write or no permission: ignore */
  }
}

export function createLogger(options = {}) {
  const level = String(options.level || 'info').toLowerCase()
  const threshold = LEVELS[level] ?? LEVELS.info
  const file = options.file || defaultLogFile()
  const consoleMirror = options.console === true
  const ctxLogger = options.ctxLogger || null

  // Retry storms log the same line thousands of times: write it once, then a count.
  let lastKey = '', repeats = 0, lastAt = 0
  function emit(lvl, scope, message, extra) {
    if ((LEVELS[lvl] ?? 0) < threshold) return
    const key = `${lvl}|${scope}|${message}`
    const t = Date.now()
    if (key === lastKey && t - lastAt < 10 * 60000) { repeats++; lastAt = t; if (repeats % 500 !== 0) return; message = `${message}（已重复 ${repeats} 次）` }
    else if (repeats > 0) { const n = repeats; repeats = 0; lastKey = ''; emit(lvl, scope, `…上一条日志又重复了 ${n} 次`) }
    lastKey = key; lastAt = t
    // Every line is redacted: upstream error bodies can echo keys or bearer tokens.
    const line = redact(
      `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${scope || 'memory'}] ` +
      `${message}${extra === undefined ? '' : ' ' + jsonable(extra)}`)
    try {
      mkdirSync(dirname(file), { recursive: true })
      rotateIfNeeded(file)
      appendFileSync(file, line + '\n')
    } catch {
      /* ignore */
    }
    if (ctxLogger) {
      try {
        const fn = ctxLogger[lvl] || ctxLogger.info
        fn.call(ctxLogger, `[${scope || 'memory'}] ${message}`)
      } catch {
        /* ignore */
      }
    }
    if (consoleMirror && (lvl === 'warn' || lvl === 'error')) {
      // eslint-disable-next-line no-console
      ;(lvl === 'error' ? console.error : console.warn)(line)
    }
  }

  function child(scope) {
    return {
      file,
      debug: (m, e) => emit('debug', scope, m, e),
      info: (m, e) => emit('info', scope, m, e),
      warn: (m, e) => emit('warn', scope, m, e),
      error: (m, e) => emit('error', scope, m, e),
      child: (sub) => child(scope ? `${scope}:${sub}` : sub)
    }
  }

  return child('memory')
}

export function errorMessage(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  return error.message || String(error)
}
