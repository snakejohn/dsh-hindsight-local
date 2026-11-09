/**
 * Recall shaping: turn Hindsight `RecallResponse.results` into a compact, cheap block
 * that is injected next to the user's prompt.
 *
 * Reranking happens server-side; this module applies the last two policies the client
 * owns: a score floor and a hard character budget. Everything here is pure.
 */
import { randomUUID } from 'node:crypto'
import { INJECTION_SOURCE_KIND } from './transcript.js'
import { fromLocal, humanLocal, isoLocal, resolveTimeZone } from './timeparse.js'
import { cleanRecallQuery, excerpt, extractIdentifiers, lexicalScore, queryTerms, supersededIds } from './engmem.js'

const TYPE_LABEL = { world: 'world', experience: 'exp', observation: 'obs' }

/**
 * The text actually sent to the retriever: the user's question without answer-format
 * instructions, boilerplate or injected memory blocks (see lib/engmem.js).
 */
export function recallQueryOf(config, prompt) {
  const raw = String(prompt || '')
  return config?.recall?.clean_query === false ? raw : cleanRecallQuery(raw)
}

export function buildRecallRequest(config, query, { now, tz, window } = {}) {
  let q = recallQueryOf(config, query).slice(0, Math.max(64, config.recall.max_query_chars))
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
  // Ask for the verbatim source chunks behind each fact: extraction paraphrases away paths,
  // symbols and codes, the chunk still has them (RecallRequest.include.chunks).
  if (config.recall.include_source !== false) {
    body.include = { chunks: { max_tokens: Math.max(512, Math.ceil((Number(config.recall.max_chars) || 4000) * 1.5)) } }
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

/** Our own retained text starts with "[2026-11-09 周一 10:25 (Asia/Shanghai)]" (renderTurn). */
function chunkStampTime(text) {
  const m = String(text || '').match(/\[(\d{4})-(\d{2})-(\d{2}) \S+ (\d{2}):(\d{2}) \(([^)\s]+)\)\]/)
  if (!m) return null
  try {
    const tz = resolveTimeZone(m[6])
    const t = fromLocal(+m[1], +m[2], +m[3], +m[4], +m[5], tz).getTime()
    return Number.isFinite(t) ? t : null
  } catch {
    return null
  }
}

function groupTime(result) {
  const local = Date.parse(result?.metadata?.local_time || '')
  return Number.isFinite(local) ? local : resultTime(result)
}

/**
 * Group recalled facts by the source chunk (one retained turn) they were extracted from and
 * rank the sources: server score + an exact-term pass over the verbatim source text
 * (identifiers in the question count triple) + the time-window boost.
 */
export function selectSources(results, config, { window, chunks, query } = {}) {
  const floor = Number(config.recall.score_threshold) || 0
  const boost = Number(config.time?.window_boost ?? 0.5)
  const topN = Math.max(1, Number(config.recall.top_n) || 6)
  const qterms = queryTerms(query || '')
  const groups = new Map()
  for (const result of Array.isArray(results) ? results : []) {
    const text = String(result?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const chunkId = result?.chunk_id || ''
    const chunk = chunkId && chunks && typeof chunks[chunkId]?.text === 'string' ? chunks[chunkId].text : ''
    const key = chunkId ? `chunk:${chunkId}` : result?.document_id ? `doc:${result.document_id}` : `fact:${result?.id || text}`
    let g = groups.get(key)
    if (!g) {
      g = { key, chunk, documentId: result?.document_id || '', facts: [], seen: new Set(), score: null, at: null, inWindow: false, ids: '' }
      groups.set(key, g)
    }
    if (!g.chunk && chunk) g.chunk = chunk
    if (!g.ids && typeof result?.metadata?.identifiers === 'string') g.ids = result.metadata.identifiers
    const fp = text.toLowerCase()
    if (g.seen.has(fp)) continue
    g.seen.add(fp)
    const score = scoreOf(result).value
    const at = groupTime(result)
    const inWindow = !!window && at !== null && at >= window.start.getTime() && at <= window.end.getTime()
    g.facts.push({ text, type: result?.type || '', score, at, inWindow })
    if (score !== null && (g.score === null || score > g.score)) g.score = score
    if (at !== null && (g.at === null || at > g.at)) g.at = at
    g.inWindow = g.inWindow || inWindow
  }
  // Lexical pass over source chunks: Hindsight returns chunks for more facts than survive its
  // own token cut, so a chunk no returned fact points to is still a candidate on exact terms.
  if (chunks && typeof chunks === 'object') {
    const used = new Set([...groups.values()].map((g) => g.chunk).filter(Boolean))
    for (const [id, c] of Object.entries(chunks)) {
      const text = typeof c?.text === 'string' ? c.text : ''
      if (!text || used.has(text)) continue
      const at = chunkStampTime(text)
      const inWindow = !!window && at !== null && at >= window.start.getTime() && at <= window.end.getTime()
      groups.set(`chunk:${id}`, { key: `chunk:${id}`, chunk: text, documentId: '', facts: [], seen: new Set(), score: null, at, inWindow, ids: '', chunkOnly: true })
    }
  }
  // Observations (consolidated facts) carry no chunk_id. When their identifiers all appear in
  // one retained source, fold them into it: same evidence, one entry, the better score counts.
  const withChunk = [...groups.values()].filter((g) => g.chunk)
  if (withChunk.length) {
    for (const g of [...groups.values()]) {
      if (g.chunk) continue
      const ids = extractIdentifiers(g.facts.map((f) => f.text).join('\n'))
      if (!ids.length) continue
      const host = withChunk.find((c) => ids.every((id) => c.chunk.toLowerCase().includes(id.toLowerCase())))
      if (!host) continue
      for (const f of g.facts) {
        const fp = f.text.toLowerCase()
        if (host.seen.has(fp)) continue
        host.seen.add(fp)
        host.facts.push({ ...f, at: host.at })
      }
      if (g.score !== null && (host.score === null || g.score > host.score)) host.score = g.score
      host.inWindow = host.inWindow || g.inWindow
      groups.delete(g.key)
    }
  }
  const ranked = []
  const candidates = []
  for (const g of groups.values()) {
    g.facts.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    g.text = g.chunk || g.facts.map((f) => f.text).join('\n')
    const lex = lexicalScore(`${g.text}\n${g.facts.map((f) => f.text).join('\n')}\n${g.ids}`, qterms)
    g.lexical = lex.score
    g.idHits = lex.idHits
    const strongLexical = lex.idHits.length > 0 || lex.score >= 0.34
    g.rank = (g.score ?? 0) + 0.6 * lex.score + (lex.idHits.length ? 0.5 : 0) + (g.inWindow ? boost : 0)
    candidates.push(g)
    if (g.chunkOnly && !strongLexical && !g.inWindow) continue
    if (!g.inWindow && floor > 0 && g.score !== null && g.score < floor && !strongLexical) continue
    ranked.push(g)
  }
  ranked.sort((a, b) => b.rank - a.rank)
  const selected = ranked.slice(0, topN)
  if (config.recall.supersede !== false) {
    // A newer record that retires something in a selected older one must be shown too,
    // otherwise the stale value would look current.
    // Over every candidate, not only those above the score floor: the record that retires an
    // old value often shares no words with the question ("task-x 已完成").
    const byTime = [...candidates].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity))
    const marks = supersededIds(byTime)
    let extra = 0
    for (const [olderIndex, entry] of marks) {
      if (!selected.includes(byTime[olderIndex])) continue
      for (const newerIndex of entry.by) {
        const newer = byTime[newerIndex]
        if (!selected.includes(newer) && extra < 2) {
          selected.push(newer)
          extra += 1
        }
      }
    }
  }
  return { sources: selected, qterms }
}

export function formatRecallBlock(results, config, bankId, { now, tz, window, chunks, query } = {}) {
  const { sources, qterms } = selectSources(results, config, { window, chunks, query })
  const nowLine = now && tz && config.time?.inject_now !== false ? `当前本地时间 / now: ${humanLocal(now, tz)}\n` : ''
  if (!sources.length) {
    // Still tell the model what time it is so "今天/7点" questions can be answered honestly.
    return nowLine ? `<memory-context bank="${bankId}">\n${nowLine}${window ? `(没有找到 ${window.label} 附近的记忆)\n` : ''}</memory-context>` : ''
  }
  const budget = Math.max(200, Number(config.recall.max_chars) || 4000)
  const sourceCap = Math.max(120, Number(config.recall.source_chars) || 600)
  // Newest first: when two records disagree about the same thing, the first one wins. A
  // time-window question ("早上7点干了啥") keeps the ranked order so ★ in-window records lead.
  const ordered = window ? [...sources] : [...sources].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity))
  const marks = config.recall.supersede === false ? new Map() : supersededIds(ordered)
  const header =
    `<memory-context bank="${bankId}">\n` +
    'Recalled long-term memory for this workspace (background only; may be stale or incomplete — verify against the current conversation). ' +
    (window ? '本工作区的长期记忆，按相关度排列（★ 在前）；' : '本工作区的长期记忆，按时间从新到旧排列；') + '「原文」是当时对话的原话摘录，路径/符号/代码以原文为准。' +
    '原文里的文件路径、文件名照原文写法使用，它们不是当前工作目录（cwd）下的路径，不要换成或拼上当前工作目录。' +
    '同一事项有多条记录时以时间最新的为准：较新记录写了「已完成」，较早记录里的「未完成/待办/下一步」就已过时；标「已被取代」的旧值只作历史参考，不要当作当前值。USER = 用户本人，ASSISTANT/角色 = 助手或角色。\n' +
    nowLine +
    (window ? `用户询问的时间段: ${window.label}${window.precision === 'hour' ? ` (±${config.time?.window_minutes ?? 60}min)` : ''}；★ = 发生在该时间段内\n` : '')
  const footer = '\n</memory-context>'
  let body = ''
  let n = 0
  for (let i = 0; i < ordered.length; i++) {
    const src = ordered[i]
    const mark = marks.get(i)
    const staleIds = mark ? [...mark.ids] : []
    const stamp = src.at !== null && tz ? humanLocal(new Date(src.at), tz) : ''
    const newest = ordered.reduce((m, x) => (x.at !== null && (m === null || x.at > m) ? x.at : m), null)
    const tags = [!window && ordered.length > 1 && src.at !== null && src.at === newest ? '最新' : '', src.inWindow ? '★' : ''].filter(Boolean).join(' ')
    const head = `[${n + 1}]${stamp ? ` ${stamp}` : ''}${tags ? ` ｜${tags}` : ''}\n`
    const isStale = (text) => staleIds.some((id) => text.toLowerCase().includes(id.toLowerCase()))
    const flat = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const chunkFlat = flat(src.chunk)
    // With the verbatim source shown, one extracted fact is enough as a summary (and none when
    // it only repeats the source).
    const facts = src.chunk ? src.facts.filter((f) => !chunkFlat.includes(flat(f.text))).slice(0, 1) : src.facts.slice(0, 3)
    const factLines = facts.map((f) => {
      const label = TYPE_LABEL[f.type] || f.type || 'mem'
      const score = f.score === null ? '' : ` (${f.score.toFixed(2)})`
      const text = f.text.length > 220 ? `${f.text.slice(0, 220)}…` : f.text
      return `${src.chunk ? '要点' : '-'} [${label}]${score}${isStale(f.text) ? '（已被取代）' : ''} ${text}\n`
    })
    const byRefs = mark ? [...mark.by].map((j) => `[${j + 1}]`).join('、') : ''
    const doneIds = staleIds.filter((id) => mark.kinds?.get(id) === 'done')
    const replacedIds = staleIds.filter((id) => mark.kinds?.get(id) !== 'done')
    const staleLine =
      (replacedIds.length ? `⚠ 此条中的 ${replacedIds.join('、')} 已被较新的记录 ${byRefs} 取代，只作历史参考。\n` : '') +
      (doneIds.length ? `⚠ 较新的记录 ${byRefs} 写明 ${doneIds.join('、')} 已完成；此条里它的「未完成/待办/下一步」状态已过时，当前状态以 ${byRefs} 为准。\n` : '')
    const fixed = head.length + factLines.join('').length + staleLine.length
    const room = budget - header.length - footer.length - body.length - fixed
    let sourceLine = ''
    if (src.chunk) {
      const cap = Math.min(sourceCap, room - 6)
      if (cap < 80) break
      sourceLine = `原文：${excerpt(src.chunk.replace(/\s*\n\s*/g, '\n'), qterms, cap)}\n`
    } else if (room < 0) break
    const entry = head + (sourceLine ? sourceLine : '') + factLines.join('') + staleLine
    if (header.length + body.length + entry.length + footer.length > budget) break
    body += entry
    n += 1
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
