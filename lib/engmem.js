/**
 * Engineering-memory helpers (pure, no I/O):
 *   - cleanRecallQuery(): strip answer-format instructions, boilerplate and injected memory
 *     blocks from a user message so only the real question reaches the retriever;
 *   - extractIdentifiers(): file paths, path::symbol, camelCase/PascalCase/snake_case names,
 *     kebab-case codes with digits, CLI flags, npm-style script names, config keys, error
 *     codes and versions — the things fact extraction tends to paraphrase away;
 *   - lexicalScore()/queryTerms(): an exact-term pass over verbatim source text;
 *   - supersededIds(): identifiers that a newer record explicitly replaces/retires.
 */

// ---------------------------------------------------------------- query cleaning

const INJECTED_BLOCKS = [
  /<memory-context\b[^>]*>[\s\S]*?<\/memory-context>/gi,
  /<(system-reminder|system|context|memory|memories|recalled-memory|relevant-memories|[\w-]*-context)\b[^>]*>[\s\S]*?<\/\1>/gi
]

/** Sentences that only tell the model HOW to answer (format, sources, refusal policy). */
const INSTRUCTION_SENTENCE = [
  /(返回|输出|回答|回复|给出|生成|整理成|写成|按照?|以|用).{0,20}(JSON|json|YAML|yaml|XML|格式|模板|markdown|Markdown|表格|列表形式|代码块)/,
  /\b(respond|reply|answer|return|output|format|formatted)\b.{0,40}\b(json|yaml|xml|format|markdown|table|schema|fields?)\b/i,
  /^(请)?(只|仅)(使用|用|根据|依据|基于|参考)/,
  /(不要|别|请勿|禁止|不得|不可|切勿|不能)(去)?(搜索|联网|上网|查网|猜|推测|编造|捏造|虚构|写入|更新|修改|执行|调用|使用工具|把|输出多余|解释)/,
  /\b(do not|don't|never|without)\b.{0,24}\b(search|guess|invent|fabricate|make up|write|update|browse|explain|use tools?)\b/i,
  /(为|设为?|填|返回|写|用|输出)\s*(null|unknown|none|空值?|N\/A|"")(\s|[。.；;，,]|$)/i,
  /\b(null|unknown)\b.{0,6}(设为?|填|为)\s*(true|false)/i,
  /(只能|必须|仅能)(是|为|填|选|取|从)?\s*[A-Za-z]+(\s*[/|、,，]\s*[A-Za-z]+)+/,
  /^(这|以下|下面)是.{0,40}(问答|测试|评测|任务|题目|考题|quiz)[。.!！]?$/
]

const FIELD_PHRASE = /[，,；;]?\s*(请)?(仅|只)?(用|使用|按|回答|返回|输出|填写)?\s*字段\s*[:：]?\s*[A-Za-z_][\w]*(\s*[,，、/]\s*[A-Za-z_][\w]*)*\s*[。；;.]?/g
const EN_FIELD_PHRASE = /[,;]?\s*\b(use|using|with|in)?\s*(the\s+)?fields?\s*[:：]?\s*`?[A-Za-z_]\w*`?(\s*[,/]\s*`?[A-Za-z_]\w*`?)+\s*[.;]?/gi
const LABEL_LINE = /^\s*(题号|编号|问题编号|序号|question(\s*id)?|item|qid)\s*[:：#]?\s*[\w-]+\s*$/i
const JSON_TEMPLATE = /\{\s*"[^"{}]{1,40}"\s*:[\s\S]{0,400}?\}/g

function weight(text) {
  let n = 0
  for (const ch of String(text || '')) n += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1
  return n
}

function splitSentences(line) {
  // CJK punctuation always ends a sentence; Latin ". ! ?" only before whitespace, so paths
  // (src/a.ts) and versions (1.2.3) stay intact.
  return line.split(/(?<=[。！？!?；;])|(?<=[.])\s+/).map((s) => s.trim()).filter(Boolean)
}

/**
 * Keep the question, drop the scaffolding. Falls back to the de-injected original when the
 * cleaning would leave (almost) nothing — a message made only of instructions is still a query.
 */
export function cleanRecallQuery(text) {
  let base = String(text || '')
  for (const re of INJECTED_BLOCKS) base = base.replace(re, ' ')
  base = base.trim()
  const kept = []
  for (const rawLine of base.split(/\n+/)) {
    if (LABEL_LINE.test(rawLine)) continue
    for (let sentence of splitSentences(rawLine)) {
      const isInstruction = INSTRUCTION_SENTENCE.some((re) => re.test(sentence))
      if (isInstruction) continue
      sentence = sentence.replace(JSON_TEMPLATE, ' ').replace(FIELD_PHRASE, '').replace(EN_FIELD_PHRASE, '').replace(/\s+/g, ' ').trim()
      if (sentence && !/^[\s，,。.；;:：]+$/.test(sentence)) kept.push(sentence)
    }
  }
  const cleaned = kept.join(' ').trim()
  if (weight(cleaned) < 4) return base.replace(/\s+/g, ' ').trim()
  return cleaned
}

// ---------------------------------------------------------------- identifiers

const EXT = 'ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|kt|kts|rb|php|c|cc|cpp|h|hpp|cs|swift|sql|md|mdx|json|jsonc|ya?ml|toml|ini|sh|bash|zsh|ps1|bat|css|scss|less|html|vue|svelte|lock|env|txt|cfg|conf|proto|gradle|xml|dockerfile|tf|lua|dart|ex|exs|erl|zig|nim|r|jl|ipynb|csv'
const ID_PATTERNS = [
  // path::symbol / Class::method / file#symbol
  /(?:[\w@.$-]+\/)*[\w@.$-]+(?:::|#)[A-Za-z_$][\w$]*(?:\(\))?/g,
  // paths with at least one slash (relative, absolute, ~ and Windows drive)
  /(?:[A-Za-z]:)?(?:~|\.{1,2})?\/?(?:[\w@.$-]+\/)+[\w@.$-]*[\w$]/g,
  // bare file names with a known extension
  new RegExp(`(?<![\\w/.-])[\\w.@-]*[\\w-]\\.(?:${EXT})(?![\\w])`, 'gi'),
  // camelCase / PascalCase with at least two humps
  /(?<![\w$])[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+(?![\w$])/g,
  /(?<![\w$])(?:[A-Z][a-z0-9]+){2,}(?![\w$])/g,
  // snake_case / SCREAMING_CASE
  /(?<![\w$])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![\w$])/g,
  // kebab-case codes (kept when they carry a digit or have 3+ parts: idle-43m, ADR-kestrel-42, outbox-pg-v3)
  /(?<![\w./-])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+(?![\w/-])/g,
  // CLI flags
  /(?<![\w-])--[A-Za-z][\w-]*(?:=[^\s,，。；;]+)?/g,
  // npm-style script names: test:cursor-reed, build:prod
  /(?<![\w:/-])[a-z][\w-]*:[a-z][\w:-]*(?![\w/])/g,
  // dotted config keys: recall.max_chars, server.port
  /(?<![\w./-])[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]+)+(?![\w.])/g,
  // versions
  /(?<![\w.])v?\d+\.\d+\.\d+(?:[-+][\w.]+)?(?![\w.])/g,
  /(?<![\w.])v\d+(?:\.\d+)?(?![\w.])/g,
  // error codes: E1234, ERR_X, ENOENT, HTTP 404 style codes
  /(?<![\w-])(?:E[A-Z]{3,}|ERR_[A-Z_]+|[A-Z]{2,}\d{2,}|[A-Z]\d{3,}|0x[0-9a-fA-F]{2,})(?![\w-])/g
]

function acceptable(id) {
  if (id.length < 3 || id.length > 160) return false
  if (/^\d+([:/-]\d+)*$/.test(id) || /^\d+\.\d+$/.test(id)) return false // dates, times, plain numbers
  if (/^https?:?$/i.test(id)) return false
  if (/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+$/.test(id) && !/\d/.test(id) && id.split('-').length < 3) return false
  if (/^(?:[a-z]+\.)+[a-z]+$/.test(id) && !/_/.test(id) && id.split('.').some((p) => p.length < 2)) return false
  return true
}

/** Engineering identifiers in order of appearance, deduplicated. */
export function extractIdentifiers(text, { limit = 40 } = {}) {
  const source = String(text || '')
  const found = []
  for (const re of ID_PATTERNS) {
    re.lastIndex = 0
    for (const m of source.matchAll(re)) {
      const id = m[0].replace(/[.,;:)\]}>'"`，。；：）】]+$/, '').replace(/^[(['"`（【<]+/, '')
      if (acceptable(id)) found.push({ id, at: m.index })
    }
  }
  found.sort((a, b) => a.at - b.at || b.id.length - a.id.length)
  const out = []
  const seen = new Set()
  for (const { id } of found) {
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(id)
    if (out.length >= limit) break
  }
  return out
}

// ---------------------------------------------------------------- lexical pass

/** Question words that say nothing about the topic. */
const STOP_BIGRAMS = new Set(
  '当前 现在 目前 什么 哪个 哪些 哪一 一个 多少 是否 有没 没有 记录 标识 分别 怎么 如何 为什么 为何 字段 一下 请问 可以 我们 你们 这个 那个 上次 之前 是什 么？ 吗？ 的是 是哪 有记 录吗 返回 回答 告诉 我的'.split(' ')
)
const ASCII_STOP = new Set('the and for with what which when where why how is are was were does did this that from into value field fields json null true false'.split(' '))

/** Weighted terms of a (cleaned) query: identifiers count triple, CJK bigrams and words once. */
export function queryTerms(query) {
  const q = String(query || '')
  const ids = extractIdentifiers(q)
  const terms = new Map()
  for (const id of ids) terms.set(id.toLowerCase(), 3)
  for (const w of q.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) || []) {
    if (!ASCII_STOP.has(w) && !terms.has(w)) terms.set(w, 1)
  }
  for (const run of q.match(/[\u3400-\u9fff]+/g) || []) {
    const chars = [...run]
    for (let i = 0; i + 1 < chars.length; i++) {
      const bg = chars[i] + chars[i + 1]
      if (!STOP_BIGRAMS.has(bg) && !terms.has(bg)) terms.set(bg, 1)
    }
  }
  return { ids, terms }
}

/** Share of the query's term weight found verbatim in `text` (0..1), plus the matched identifiers. */
export function lexicalScore(text, qterms) {
  const hay = String(text || '').toLowerCase()
  let total = 0
  let hit = 0
  const idHits = []
  for (const [term, w] of qterms.terms) {
    total += w
    if (hay.includes(term)) {
      hit += w
      if (w >= 3) idHits.push(term)
    }
  }
  return { score: total ? hit / total : 0, idHits }
}

// ---------------------------------------------------------------- supersession

const RETIRE = /(替代|取代|代替|作废|废弃|弃用|不再(使用|有效|采用|需要)?|已失效|失效|已过时|过时|已完成|已上线|已修复|已关闭|已撤销|撤回|回退了|deprecated|superseded|obsolete|replaced|no longer|retired|reverted|is done|completed)/i
const NOT_DONE = /(未|没有?|尚未|仍未|还没)(完成|上线|修复|关闭)|\b(not|never|isn't|wasn't)\b.{0,12}\b(completed|done|retired|replaced)\b/i
const REPLACE_WITH = /(改为|改成|改用|换成|换为|更新为|调整为|升级为|迁移到|切换到|replaced by|switch(ed)? to|changed to|now uses?)/i

/**
 * Identifiers a record retires: those in sentences that say "X 已作废 / 替代 X / X 已完成",
 * excluding the new values introduced after "改为 / changed to" in the same sentence.
 */
export function retiredIdentifiers(text) {
  const out = new Set()
  for (const line of String(text || '').split(/\n+/)) {
    for (const sentence of splitSentences(line)) {
      // Clause level: "task-a 已完成，通过 code-b" retires task-a only, not code-b.
      for (const clause of sentence.split(/[，,：；;。]|:\s/)) {
        const retires = RETIRE.test(clause) && !NOT_DONE.test(clause)
        if (!retires && !REPLACE_WITH.test(clause)) continue
        const ids = extractIdentifiers(clause)
        if (!ids.length) continue
        // Values after a "change to" verb are the new current ones.
        const fresh = new Set()
        for (const part of clause.split(REPLACE_WITH).slice(1)) {
          for (const id of extractIdentifiers(String(part || ''))) fresh.add(id.toLowerCase())
        }
        for (const id of ids) if (!fresh.has(id.toLowerCase())) out.add(id)
      }
    }
  }
  return [...out]
}

/**
 * Given sources sorted newest-first ({ text, at }), returns Map(index -> { ids, byIndex })
 * listing the identifiers in an OLDER source that a NEWER source retires.
 */
export function supersededIds(sources) {
  const result = new Map()
  for (let i = 0; i < sources.length; i++) {
    const newer = sources[i]
    const retired = retiredIdentifiers(newer.text)
    if (!retired.length) continue
    for (let j = 0; j < sources.length; j++) {
      if (j === i) continue
      const older = sources[j]
      if (!(newer.at !== null && older.at !== null && older.at < newer.at)) continue
      const hay = String(older.text || '').toLowerCase()
      const hits = retired.filter((id) => hay.includes(id.toLowerCase()))
      if (!hits.length) continue
      const entry = result.get(j) || { ids: new Set(), by: new Set() }
      for (const id of hits) entry.ids.add(id)
      entry.by.add(i)
      result.set(j, entry)
    }
  }
  return result
}

/** Keep the most relevant sentences of a long source, in original order, within `cap` chars. */
export function excerpt(text, qterms, cap) {
  const value = String(text || '').trim()
  if (value.length <= cap) return value
  const pieces = []
  for (const line of value.split(/\n/)) for (const s of splitSentences(line)) pieces.push(s)
  const scored = pieces.map((s, i) => ({ s, i, score: lexicalScore(s, qterms).score + (extractIdentifiers(s).length ? 0.05 : 0) }))
  const order = [...scored].sort((a, b) => b.score - a.score || a.i - b.i)
  const chosen = new Set()
  let used = 0
  for (const p of order) {
    if (used + p.s.length + 2 > cap) continue
    chosen.add(p.i)
    used += p.s.length + 2
  }
  if (!chosen.size) return value.slice(0, Math.max(0, cap - 1)) + '…'
  let out = ''
  let last = -1
  for (const p of scored) {
    if (!chosen.has(p.i)) continue
    if (last >= 0 && p.i !== last + 1) out += ' … '
    else if (last >= 0) out += ' '
    out += p.s
    last = p.i
  }
  if (last < pieces.length - 1) out += ' …'
  if ([...chosen][0] !== 0 && !chosen.has(0)) out = '… ' + out
  return out
}
