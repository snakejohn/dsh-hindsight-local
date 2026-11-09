/**
 * Engineering memory (v0.1.10 dev): clean recall query, identifiers survive retain and drive
 * recall, verbatim source excerpts via include.chunks, newer records supersede older ones.
 * Run: node tests/test-engineering-memory.mjs
 */
import assert from 'node:assert/strict'
import { cleanRecallQuery, extractIdentifiers, retiredIdentifiers, queryTerms, lexicalScore } from '../lib/engmem.js'
import { buildRecallRequest, formatRecallBlock } from '../lib/recall.js'
import { DEFAULT_CONFIG, resolveConfig } from '../lib/config.js'
import { buildRuntime, createFakeAgent, createFakeClient, createFakeCtx } from './harness.mjs'

const ok = (m) => console.log('PASS ' + m)
const cfg = (over = {}) => resolveConfig({ recall: { ...over } }, { env: {} }).config

// 1. query cleaning ---------------------------------------------------------------------
{
  const prompt =
    '这是合成工程项目的跨会话记忆问答。只使用本轮可获取的记忆；不要搜索互联网或猜测，不要写入/更新记忆。' +
    '请返回 JSON {"values":{问题要求的字段:值},"evidence_source_ids":[],"unknown":false}；无依据的值为null，unknown设true。' +
    '不得把过时事实冒充当前事实。\n题号 Q14\n断电重放任务现在状态与验收码？字段 status,acceptance；状态只能 completed/pending/unknown。'
  assert.equal(cleanRecallQuery(prompt), '断电重放任务现在状态与验收码？')
  assert.equal(cleanRecallQuery('当前空闲过期标识？用字段 value。'), '当前空闲过期标识？')
  assert.equal(cleanRecallQuery('当前项目的发布审批口令标识有记录吗？仅回答字段 value；没有记录为 null。'), '当前项目的发布审批口令标识有记录吗？')
  assert.equal(
    cleanRecallQuery('<memory-context bank="x">- 旧记忆 src/old.ts</memory-context>\nWhy does src/a.ts::loadConfig throw ENOENT? Answer in JSON format. Do not guess.'),
    'Why does src/a.ts::loadConfig throw ENOENT?'
  )
  // Nothing but an instruction: keep it rather than send an empty query.
  assert.equal(cleanRecallQuery('请用 JSON 格式回答'), '请用 JSON 格式回答')
  // Ordinary requests are untouched.
  const plain = '帮我看看 packages/ledger/src/commitReed.ts 里 commitReedBatch 为什么报错，用 --watch 跑一下'
  assert.equal(cleanRecallQuery(plain), plain)
  ok('recall query: format/answer instructions, labels, injected blocks stripped; question kept')
}

// 2. identifiers ---------------------------------------------------------------------------
{
  const ids = extractIdentifiers(
    '迁移入口改为 db/migrations/046_hazel.sql；新符号 src/upgrade/checkWillow.ts::checkWillowMode；' +
      '运行 pnpm test:readonly-willow --runInBand；配置 recall.max_chars；版本 v0.1.9 / 1.1.0；错误 ENOENT、E1234、ERR_REQUIRE_ESM；' +
      '决策 ADR-kestrel-42 选 outbox-pg-v3；测试库 amber_eval_z7；类 LedgerWriter；文件 rollback-elm.md'
  )
  for (const id of ['db/migrations/046_hazel.sql', 'src/upgrade/checkWillow.ts::checkWillowMode', 'checkWillowMode', 'test:readonly-willow', '--runInBand', 'recall.max_chars', 'v0.1.9', '1.1.0', 'ENOENT', 'E1234', 'ERR_REQUIRE_ESM', 'ADR-kestrel-42', 'outbox-pg-v3', 'amber_eval_z7', 'LedgerWriter', 'rollback-elm.md']) {
    assert.ok(ids.includes(id), `${id} detected in ${ids.join(' | ')}`)
  }
  assert.ok(!extractIdentifiers('今天 10:24 开会，read-only 模式，2026-11-09').length, 'times, dates and plain hyphenated words are not identifiers')
  const qt = queryTerms('commitReedBatch 在哪个文件？')
  assert.ok(lexicalScore('账本写入入口 packages/ledger/src/commitReed.ts，符号 commitReedBatch', qt).idHits.includes('commitreedbatch'))
  ok('identifiers: paths, path::symbol, camel/Pascal/snake, kebab codes, flags, scripts, config keys, versions, error codes')
}

// 3. supersession -------------------------------------------------------------------------
{
  const retired = retiredIdentifiers('需求 REV-b 替代 REV-a：会话空闲过期改为 idle-43m，原因码 audit-longform-2。idle-19m 和 031_reed.sql 已作废。task-hazel-31 已完成，通过 replay-zero-gap-5。仍未完成 task-willow-62。')
  assert.deepEqual(retired.sort(), ['031_reed.sql', 'idle-19m', 'task-hazel-31'])
  ok('retired identifiers: 作废/已完成 clauses only; new values after 改为, acceptance codes and open tasks untouched')
}

// 4. recall request ----------------------------------------------------------------------
{
  const body = buildRecallRequest(cfg(), '请返回 JSON。\n当前迁移入口？字段 value。')
  assert.equal(body.query, '当前迁移入口？')
  assert.ok(body.include?.chunks && body.include.chunks.max_tokens >= 512, 'include.chunks requested')
  const legacy = buildRecallRequest(cfg({ include_source: false, clean_query: false }), '请返回 JSON。\n当前迁移入口？')
  assert.ok(!legacy.include && legacy.query.includes('请返回 JSON'), 'both can be turned off')
  assert.equal(DEFAULT_CONFIG.recall.include_source, true)
  assert.equal(DEFAULT_CONFIG.recall.clean_query, true)
  ok('recall request: cleaned query + include.chunks (default on, switchable)')
}

// 5. injection: verbatim source, identifier boost, newest wins, budget -------------------------
const OLD = '[2026-11-09 周一 10:25 (Asia/Shanghai)] USER（用户本人）: 需求 REV-a：会话空闲过期采用 idle-19m；迁移入口 db/migrations/031_reed.sql。这两项目前有效。'
const NEW = '[2026-11-09 周一 10:31 (Asia/Shanghai)] USER（用户本人）: 需求 REV-b 已批准：会话空闲过期改为 idle-43m；迁移入口改为 db/migrations/046_hazel.sql。idle-19m 和 031_reed.sql 已作废，仅保留历史追溯。'
const LEDGER = '[2026-11-09 周一 10:24 (Asia/Shanghai)] USER（用户本人）: 账本写入入口 packages/ledger/src/commitReed.ts，符号 commitReedBatch。'
const fact = (id, text, score, chunk, local) => ({ id, text, type: 'world', chunk_id: chunk, document_id: `s:${chunk}`, scores: { final: score }, metadata: { local_time: local } })
const results = [
  fact('f1', '用户确认接收当前工程开发会话的进展，采用 idle-19m 会话空闲过期。', 0.31, 'c-old', '2026-11-09T10:25:00+08:00'),
  fact('f2', '用户确认接收当前工程开发会话的进展。', 0.27, 'c-new', '2026-11-09T10:31:00+08:00'),
  // Extraction lost the path and symbol, and the server score is below the floor.
  fact('f3', '用户确认了账本写入入口。', 0.12, 'c-ledger', '2026-11-09T10:24:00+08:00')
]
const chunks = { 'c-old': { id: 'c-old', text: OLD, chunk_index: 0 }, 'c-new': { id: 'c-new', text: NEW, chunk_index: 0 }, 'c-ledger': { id: 'c-ledger', text: LEDGER, chunk_index: 0 } }
{
  const now = new Date('2026-11-09T03:40:00Z')
  const block = formatRecallBlock(results, cfg(), 'bank-a', { now, tz: 'Asia/Shanghai', chunks, query: '当前会话空闲过期标识？' })
  assert.match(block, /^<memory-context bank="bank-a">/)
  assert.ok(block.includes('idle-43m') && block.includes('db/migrations/046_hazel.sql'), 'verbatim source carries what extraction dropped')
  const iNew = block.indexOf('idle-43m')
  const iOld = block.indexOf('采用 idle-19m')
  assert.ok(iNew > 0 && iOld > iNew, 'newest record first')
  assert.match(block, /\[1\] 2026-11-09 周一 10:31.*最新/)
  assert.match(block, /⚠ 此条中的 idle-19m、031_reed\.sql 已被较新的记录 \[1\] 取代/)
  assert.match(block, /要点 \[world\] \(0\.31\)（已被取代） 用户确认接收.*idle-19m/)
  assert.ok(!block.includes('commitReedBatch'), 'below-floor source without a term match stays out')
  ok('injection: verbatim 原文 excerpt, newest first, older values marked 已被取代')

  const sym = formatRecallBlock(results, cfg(), 'bank-a', { now, tz: 'Asia/Shanghai', chunks, query: 'commitReedBatch 在哪个文件？' })
  assert.ok(sym.includes('packages/ledger/src/commitReed.ts'), `identifier in the question pulls the below-floor source in:\n${sym}`)
  ok('exact-term pass: an identifier in the question rescues a source the reranker scored low')

  const tight = formatRecallBlock(results, cfg({ max_chars: 600 }), 'bank-a', { now, tz: 'Asia/Shanghai', chunks, query: '当前会话空闲过期标识？' })
  assert.ok(tight.length <= 600, `budget respected (${tight.length})`)
  assert.ok(tight.includes('idle-43m'), 'the newest source survives a tight budget')
  const noChunks = formatRecallBlock(results, cfg(), 'bank-a', { now, tz: 'Asia/Shanghai', query: '当前会话空闲过期标识？' })
  assert.ok(noChunks.includes('- [world] (0.31)') && !noChunks.includes('原文：'), 'older servers without chunks: facts as before')
  ok('budget: max_chars honoured; no chunks -> fact list fallback')

  // A chunk no returned fact points to (its facts fell under Hindsight's token cut) is still
  // found by exact terms; a below-floor newer record that retires a selected value is pulled in.
  const RETRY = '[2026-11-09 周一 10:26 (Asia/Shanghai)] USER（用户本人）: 重试策略 jitter-cap-11，原因码 herd-break-4。'
  const TASK_OLD = '[2026-11-09 周一 10:25 (Asia/Shanghai)] USER（用户本人）: 仍未完成 task-hazel-31（验证断电重放）；验收条件 replay-zero-gap-5。'
  const TASK_NEW = '[2026-11-09 周一 10:32 (Asia/Shanghai)] USER（用户本人）: 收尾更新：task-hazel-31 已完成，通过 replay-zero-gap-5。'
  const more = { ...chunks, 'c-retry': { text: RETRY }, 'c-told': { text: TASK_OLD }, 'c-tnew': { text: TASK_NEW } }
  const rr = [
    ...results,
    fact('t1', '未完成 task-hazel-31（验证断电重放），验收条件 replay-zero-gap-5。', 0.8, 'c-told', '2026-11-09T10:25:00+08:00'),
    fact('t2', '用户完成了 task-hazel-31。', 0.05, 'c-tnew', '2026-11-09T10:32:00+08:00')
  ]
  const retry = formatRecallBlock(rr, cfg(), 'b', { now, tz: 'Asia/Shanghai', chunks: more, query: '重试策略和原因码？' })
  assert.ok(retry.includes('jitter-cap-11') && retry.includes('herd-break-4'), `unreferenced chunk found by exact terms:\n${retry}`)
  const task = formatRecallBlock(rr, cfg(), 'b', { now, tz: 'Asia/Shanghai', chunks: more, query: '断电重放任务现在状态与验收码？' })
  assert.ok(task.indexOf('task-hazel-31 已完成') > 0 && task.indexOf('task-hazel-31 已完成') < task.indexOf('仍未完成 task-hazel-31'), `newer completion shown first:\n${task}`)
  assert.match(task, /⚠ 此条中的 task-hazel-31 已被较新的记录 \[1\]/)
  ok('lexical pass over unreferenced chunks; a below-floor newer record that retires a value is pulled in')

  // Long chunk: excerpt keeps the sentences with the asked-about terms.
  const long = 'USER: ' + '无关的闲聊内容。'.repeat(120) + '回滚触发器 lag-over-37s，执行 playbook/rollback-elm.md 的 rollbackElm。' + '更多闲聊。'.repeat(80)
  const lr = formatRecallBlock([fact('x', '用户聊了很多。', 0.5, 'c-long', '2026-11-09T10:20:00+08:00')], cfg(), 'b', { now, tz: 'Asia/Shanghai', chunks: { 'c-long': { text: long } }, query: '回滚触发器是什么？' })
  assert.ok(lr.includes('lag-over-37s') && lr.includes('rollbackElm') && lr.length < 1400, 'excerpt centred on the relevant sentence')
  ok('long source: excerpt keeps the relevant sentences within source_chars')
}

// 6. runtime: retain keeps identifiers, pre-step uses the cleaned query + chunks --------------
{
  const client = createFakeClient({ results, chunks })
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: '' } } })
  const T = (n) => new Date(Date.UTC(2026, 10, 9, 2, n)).toISOString()
  const ev = [
    { type: 'user/message', time: T(1), data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '新符号位置 src/upgrade/checkWillow.ts::checkWillowMode，下一步 pnpm test:readonly-willow。<memory-context bank="b">- 注入的 src/injected.ts</memory-context>' }] } },
    { type: 'assistant/message', time: T(2), data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '收到，checkWillowMode 记下了。' }] } } }
  ]
  const session = { header: { id: 'sx', cwd: '/tmp/ws-eng' }, id: 'sx', snapshotEvents: (since = 0) => ev.slice(since) }
  const agent = createFakeAgent({ session })
  await runtime.retainAgent(agent)
  const item = client.calls.retain.flatMap((c) => c.items)[0]
  assert.ok(item.content.includes('src/upgrade/checkWillow.ts::checkWillowMode'), 'content verbatim')
  assert.match(item.metadata.identifiers, /src\/upgrade\/checkWillow\.ts::checkWillowMode/)
  assert.match(item.metadata.identifiers, /test:readonly-willow/)
  assert.ok(!item.metadata.identifiers.includes('src/injected.ts') && !item.content.includes('src/injected.ts'), 'injected memory never retained')
  assert.match(item.context, /逐字保留.*checkWillowMode/)
  assert.ok(Object.values(item.metadata).every((v) => typeof v === 'string'), 'metadata stays map<string,string>')
  ok('retain: identifiers named in extraction context + metadata.identifiers; content unchanged; injected blocks excluded')

  const ctx = createFakeCtx({ services: {} })
  runtime.attach(ctx)
  const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '只使用记忆，返回 JSON。\n当前会话空闲过期标识？字段 value。' }], source: { kind: 'user' } }]
  const decision = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 7, step: 1 }, () => ({ kind: 'enter', messages: admitted }))
  const call = client.calls.recall.at(-1)
  assert.equal(call.body.query, '当前会话空闲过期标识？')
  assert.ok(call.body.include.chunks)
  const text = decision.messages.at(-1).content[0].text
  assert.ok(text.includes('原文：') && text.includes('idle-43m') && text.includes('已被较新的记录'))
  ok('pre-step: cleaned query, chunks requested, verbatim + superseded block injected')
  await runtime.shutdown?.()
}
