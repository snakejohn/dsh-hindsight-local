/**
 * Recall shaping: turn Hindsight `RecallResponse.results` into a compact, cheap block
 * that is injected next to the user's prompt.
 *
 * Reranking happens server-side; this module applies the last two policies the client
 * owns: a score floor and a hard character budget. Everything here is pure.
 */
import { randomUUID } from 'node:crypto'
import { INJECTION_SOURCE_KIND } from './transcript.js'
import { humanLocal, isoLocal } from './timeparse.js'

const TYPE_LABEL = { world: 'world', experience: 'exp', observation: 'obs' }

export function buildRecallRequest(config, query, { now, tz, window } = {}) {
  let q = String(query || '').slice(0, Math.max(64, config.recall.max_query_chars))
  // Spell the resolved absolute time into the query: retained text carries
  // "[2026-10-24 周六 07:03 …]" stamps, so this also helps the keyword/semantic legs.
  // Hindsight's own temporal leg turns a date in the query into a UTC day, which misses local
  // mornings east of UTC (07:00 Asia/Shanghai = previous UTC day). Widen the server-side range by
  // one day on each side; selectResults() then applies the exact local window (inWindow boost).
  if (window) q += `（时间：${window.label}，检索范围 ${utcDay(window.start, -1)} 至 ${utcDay(window.end, 1)}）`
  const body = {
    query: q,
    budget: config.recall.budget,
    max_tokens: config.recall.max_tokens
  }
  if (Array.isArray(config.recall.types) && config.recall.types.length) body.types = config.recall.types
  if (Array.isArray(config.recall.tags) && config.recall.tags.length) {
    body.tags = config.recall.tags
    body.tags_match = config.recall.tags_match
  }
  // RecallRequest.query_timestamp: "query-time anchor for relative temporal expressions and
  // recency scoring". Without it the server anchors "今天/昨天" to its own clock and UTC day.
  if (now && tz) body.query_timestamp = isoLocal(now, tz)
  // The floor is applied client-side only (selectResults); sending it as min_scores too
  // filtered twice and dropped time-matching but low-similarity facts.
  if (window) body.budget = config.recall.budget === 'low' ? 'mid' : config.recall.budget
  return body
}

function scoreOf(result) {
  const scores = result?.scores || {}
  for (const key of ['final', 'reranker', 'semantic']) {
    const value = scores[key]
    if (typeof value === 'number' && Number.isFinite(value)) return { value, key }
  }
  return { value: null, key: 'none' }
}

/** Hindsight stores a date-only "When" as UTC midnight (shows as 08:00 in Asia/Shanghai). */
export function isUtcMidnight(iso) {
  return /T00:00:00(\.0\d{0,5})?(Z|\+00:00)$/.test(String(iso || ''))
}

export function resultTime(result) {
  if (isUtcMidnight(result?.occurred_start)) {
    const m = Date.parse(result?.mentioned_at || '')
    if (Number.isFinite(m)) return m
  }
  for (const k of ['occurred_start', 'mentioned_at', 'occurred_end']) {
    const t = Date.parse(result?.[k] || '')
    if (Number.isFinite(t)) return t
  }
  const t = Date.parse(result?.metadata?.local_time || '')
  return Number.isFinite(t) ? t : null
}

export function selectResults(results, config, { window } = {}) {
  const floor = Number(config.recall.score_threshold) || 0
  const boost = Number(config.time?.window_boost ?? 0.5)
  const topN = Math.max(1, Number(config.recall.top_n) || 6)
  const seen = new Set()
  const ranked = []

  for (const result of Array.isArray(results) ? results : []) {
    const text = String(result?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const score = scoreOf(result)
    const at = resultTime(result)
    const inWindow = !!window && at !== null && at >= window.start.getTime() && at <= window.end.getTime()
    if (!inWindow && floor > 0 && score.value !== null && score.value < floor) continue
    const fingerprint = text.toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    ranked.push({ text, type: result?.type || '', score: score.value, at, inWindow, rank: (score.value ?? 0) + (inWindow ? boost : 0) })
  }

  ranked.sort((a, b) => b.rank - a.rank)
  return ranked.slice(0, topN)
}

export function formatRecallBlock(results, config, bankId, { now, tz, window } = {}) {
  const selected = selectResults(results, config, { window })
  const nowLine = now && tz && config.time?.inject_now !== false ? `当前本地时间 / now: ${humanLocal(now, tz)}\n` : ''
  if (!selected.length) {
    // Still tell the model what time it is so "今天/7点" questions can be answered honestly.
    return nowLine ? `<memory-context bank="${bankId}">\n${nowLine}${window ? `(没有找到 ${window.label} 附近的记忆)\n` : ''}</memory-context>` : ''
  }
  const budget = Math.max(200, Number(config.recall.max_chars) || 4000)
  const header =
    `<memory-context bank="${bankId}">\n` +
    'Recalled long-term memory for this workspace. Background only: it can be stale or incomplete — ' +
    'verify against the current conversation before relying on it. Each item is stamped with ' +
    'the local time it happened; USER = the human player, ASSISTANT/角色 = the character.\n' +
    nowLine +
    (window ? `用户询问的时间段: ${window.label}${window.precision === 'hour' ? ` (±${config.time?.window_minutes ?? 60}min)` : ''}；★ = 发生在该时间段内\n` : '')
  const footer = '\n</memory-context>'
  let body = ''
  for (const item of selected) {
    const label = TYPE_LABEL[item.type] || item.type || 'mem'
    const score = item.score === null ? '' : ` (${item.score.toFixed(2)})`
    const stampText = item.at !== null && tz ? humanLocal(new Date(item.at), tz) : ''
    const when = stampText && !item.text.includes(stampText) ? ` [${stampText}]` : ''
    const star = item.inWindow ? '★' : ''
    const line = `- ${star}[${label}]${score}${when} ${item.text}\n`
    if (header.length + body.length + line.length + footer.length > budget) break
    body += line
  }
  if (!body) return ''
  return header + body.trimEnd() + footer
}

/** A synthetic user message that carries the recalled memory into the model step. */
export function injectionMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: INJECTION_SOURCE_KIND, form: 'recall' }
  }
}

function utcDay(date, deltaDays) {
  const d = new Date(date.getTime() + deltaDays * 86400000)
  return d.toISOString().slice(0, 10)
}
