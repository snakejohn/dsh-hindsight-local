/**
 * Minimal, dependency-free logger.
 *
 * Writes to a rotating file (default `~/.dsh-hindsight/plugin.log`) and, when the
 * Cordis context exposes a logger service, mirrors into the DSH log as well.
 * Every filesystem operation is best-effort: logging must never break a turn.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }
const MAX_BYTES = 8 * 1024 * 1024

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

function rotateIfNeeded(file) {
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
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

  function emit(lvl, scope, message, extra) {
    if ((LEVELS[lvl] ?? 0) < threshold) return
    const line =
      `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${scope || 'memory'}] ` +
      `${message}${extra === undefined ? '' : ' ' + jsonable(extra)}`
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
