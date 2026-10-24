/**
 * Time handling for role-play memory: local-time rendering in a configurable IANA zone and a
 * small zh/en parser that turns "今天早上7点" / "昨天下午" / "7am" into an absolute window.
 *
 * Why client-side: Hindsight's own analyzer (hindsight_api/engine/query_analyzer.py,
 * DateparserQueryAnalyzer) resolves relative expressions to whole *days* only, and returns no
 * constraint for a bare "早上7点" (verified offline: "我早上7点干了啥" -> None,
 * "今天早上7点我在做什么" -> 2026-10-24..2026-10-24). Hour-level precision has to come from us.
 */
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']

export function defaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Hong_Kong'
  } catch {
    return 'Asia/Hong_Kong'
  }
}

export function resolveTimeZone(tz) {
  const zone = tz || defaultTimeZone()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return 'Asia/Hong_Kong'
  }
}

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })
  const o = {}
  for (const p of f.formatToParts(date)) o[p.type] = p.value
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) }
}

/** Offset (minutes) of `tz` at instant `date`. */
export function offsetMinutes(date, tz) {
  const p = parts(date, tz)
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

const pad = (n) => String(n).padStart(2, '0')
const fmtOffset = (min) => `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`

/** ISO 8601 with the zone's offset, e.g. 2026-10-24T07:03:00+08:00 */
export function isoLocal(date, tz) {
  const p = parts(date, tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${fmtOffset(offsetMinutes(date, tz))}`
}

/** Human text: 2026-10-24 周六 07:03 (Asia/Hong_Kong) */
export function humanLocal(date, tz) {
  const p = parts(date, tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)} 周${WEEK_ZH[p.wd]} ${pad(p.h)}:${pad(p.mi)} (${tz})`
}

/** Local wall-clock (y,m,d,h,mi) in tz -> Date. */
export function fromLocal(y, m, d, h, mi, tz) {
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi))
  const off = offsetMinutes(guess, tz)
  return new Date(guess.getTime() - off * 60000)
}

const CN_NUM = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function cnToInt(s) {
  if (/^\d+$/.test(s)) return +s
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] ?? 0)
  if (s.endsWith('十')) return (CN_NUM[s[0]] ?? 0) * 10
  if (s.includes('十')) return (CN_NUM[s[0]] ?? 0) * 10 + (CN_NUM[s[2]] ?? 0)
  return CN_NUM[s] ?? NaN
}

const PERIODS = [
  [/凌晨|半夜|深夜/, [0, 6], 'am'],
  [/早上|早晨|清晨|上午|今早|一早|this morning|\bmorning\b/i, [5, 12], 'am'],
  [/中午|noon/i, [11, 14], 'pm'],
  [/下午|afternoon/i, [12, 18], 'pm'],
  [/傍晚|evening/i, [17, 20], 'pm'],
  [/晚上|今晚|夜里|夜晚|tonight|\bnight\b/i, [18, 24], 'pm']
]

/**
 * Parse a relative time expression in `query`. Returns null or
 * { start: Date, end: Date, label, precision: 'hour'|'period'|'day' }.
 */
export function parseTimeWindow(query, { now = new Date(), tz = defaultTimeZone(), windowMinutes = 60 } = {}) {
  const q = String(query || '')
  const n = parts(now, tz)
  let dayOffset = null
  if (/前天|day before yesterday/i.test(q)) dayOffset = -2
  else if (/昨天|昨晚|昨日|昨早|yesterday|last night/i.test(q)) dayOffset = -1
  else if (/今天|今早|今晚|今日|today|this morning|tonight/i.test(q)) dayOffset = 0
  const nd = /(\d+|[一二两三四五六七八九十]+)\s*天前|(\d+)\s*days? ago/i.exec(q)
  if (nd) dayOffset = -cnToInt(nd[1] || nd[2])

  let period = null
  for (const [re, range, half] of PERIODS) if (re.test(q)) { period = { range, half }; break }

  let hour = null
  let minute = 0
  const zh = /(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*[点點时](?:\s*(半|一刻|三刻|(\d{1,2}|[零一二三四五六七八九十]{1,3})\s*分?))?/.exec(q)
  const en = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|o'clock)\b/i.exec(q)
  const hm = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(q)
  if (zh) {
    hour = cnToInt(zh[1])
    if (zh[2] === '半') minute = 30
    else if (zh[2] === '一刻') minute = 15
    else if (zh[2] === '三刻') minute = 45
    else if (zh[3]) minute = cnToInt(zh[3])
  } else if (en) {
    hour = +en[1]
    minute = en[2] ? +en[2] : 0
    const ap = en[3].toLowerCase()
    if (ap.startsWith('p') && hour < 12) hour += 12
    if (ap.startsWith('a') && hour === 12) hour = 0
  } else if (hm) {
    hour = +hm[1]
    minute = +hm[2]
  }
  if (hour !== null && (!Number.isFinite(hour) || hour > 24)) hour = null
  if (hour !== null && period && period.half === 'pm' && hour < 12) hour += 12

  if (dayOffset === null && hour === null && !period) return null

  const base = new Date(Date.UTC(n.y, n.m - 1, n.d))
  const dayOf = (off) => {
    const d = new Date(base.getTime() + off * 86400000)
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
  }
  if (hour !== null) {
    // Bare "7点" with no day word: the most recent past 7:00 (today if already passed).
    let off = dayOffset
    if (off === null) off = hour * 60 + minute <= n.h * 60 + n.mi ? 0 : -1
    const [y, m, d] = dayOf(off)
    const at = fromLocal(y, m, d, hour, minute, tz)
    const w = Math.max(10, windowMinutes) * 60000
    return { start: new Date(at.getTime() - w), end: new Date(at.getTime() + w), at, label: `${y}-${pad(m)}-${pad(d)} ${pad(hour)}:${pad(minute)}`, precision: 'hour' }
  }
  const off = dayOffset ?? 0
  const [y, m, d] = dayOf(off)
  const [h0, h1] = period ? period.range : [0, 24]
  return { start: fromLocal(y, m, d, h0, 0, tz), end: fromLocal(y, m, d, h1, 0, tz), label: `${y}-${pad(m)}-${pad(d)}${period ? ` ${pad(h0)}:00-${pad(h1)}:00` : ''}`, precision: period ? 'period' : 'day' }
}
