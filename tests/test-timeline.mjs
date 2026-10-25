/**
 * Role-play time scenario against the offline mock Hindsight (tests/mock-hindsight.mjs):
 * 07:03 HKT the user says they were scrolling funny videos; at 15:00 HKT they ask
 * "我早上7点干了啥". Checks retain timestamps/text, recall query_timestamp, window ★ ranking,
 * and the injected "now" line. No model / key needed.
 */
import assert from 'node:assert/strict'
import { createMock, mockLog } from './mock-hindsight.mjs'
import { createRuntime } from '../lib/runtime.js'
import { buildSession, createFakeAgent, createFakeCtx } from './harness.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const server = createMock().listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const base = `http://127.0.0.1:${server.address().port}`
const { runtime } = createRuntime({
  rawConfig: {
    service: { mode: 'attach', base_url: base, autostart: false },
    time: { timezone: 'Asia/Hong_Kong' },
    retain: { state_dir: mkdtempSync(join(tmpdir(), 'hs-tl-')), async: false },
    prune: { enabled: false },
    backfill: { enabled: false },
    logging: { console: false }
  }
})
assert.equal(await runtime.boot('test'), true)

const T = (hk) => Date.parse(`2026-10-24T${hk}:00+08:00`)
const session = buildSession({
  id: 'rp-day',
  turns: [
    { user: '早上好！我刚刷了半个小时的搞笑视频，笑死我了', assistant: '（艾琳揉了揉眼睛）主人一大早就这么开心呀，是什么视频？' },
    { user: '十点了，我去楼下吃了碗牛肉面当早午餐', assistant: '（艾琳记在小本子上）牛肉面，加不加辣？' },
    { user: '中午我睡了个午觉，梦见在海边', assistant: '（艾琳轻声）那一定是个好梦呢。' }
  ]
})
session.header.agentPreset = '艾琳'
const times = ['07:03', '07:04', '10:00', '10:01', '12:30', '12:31']
let k = 0
for (const e of session.log) {
  if (e.type === 'user/message' || e.type === 'assistant/message') e.time = T(times[k++] || '12:40')
  else e.time = T('07:00')
}
const agent = createFakeAgent({ session })
runtime.attach(createFakeCtx({ services: {} }))
await runtime.retainAgent(agent)
await runtime.flush()

const retains = mockLog.filter((r) => r.url.endsWith('/memories'))
const items = retains.flatMap((r) => r.body.items)
assert.equal(items.length, 3)
assert.equal(items[0].timestamp, '2026-10-24T07:03:00+08:00', 'original event time with HK offset')
assert.match(items[0].content, /\[2026-10-24 周六 07:03 \(Asia\/Hong_Kong\)\] USER（用户本人）: 早上好！我刚刷了半个小时的搞笑视频/)
assert.match(items[0].content, /\[2026-10-24 周六 07:04 \(Asia\/Hong_Kong\)\] 角色「艾琳」\(ASSISTANT\)/)
console.log('PASS retain: real event time (+08:00) and per-speaker local-time stamps')

runtime.now = () => new Date(T('15:00'))
const block = await runtime.recallFor(agent, '我早上7点干了啥', 99)
const recall = mockLog.filter((r) => r.url.endsWith('/recall')).at(-1).body
assert.equal(recall.query_timestamp, '2026-10-24T15:00:00+08:00')
assert.match(recall.query, /时间：2026-10-24 07:00/)
assert.match(recall.query, /检索范围 2026-10-2[23] 至 2026-10-2[45]/)
assert.ok(!recall.min_scores, 'no double score floor')
console.log('PASS recall request: query_timestamp + resolved absolute time')
assert.match(block, /当前本地时间 \/ now: 2026-10-24 周六 15:00 \(Asia\/Hong_Kong\)/)
const lines = block.split('\n').filter((l) => l.startsWith('- '))
assert.match(lines[0], /^- ★.*07:03.*搞笑视频/, `first line is the 07:03 memory:\n${block}`)
assert.ok(!lines.slice(1).some((l) => l.startsWith('- ★')), 'only the 7am memory is in-window')
console.log('PASS recall block: 7am memory starred first, timestamps + now injected')
console.log(block)

runtime.now = () => new Date(T('15:05'))
const noon = await runtime.recallFor(agent, '中午我干嘛了', 100)
assert.match(noon.split('\n').find((l) => l.startsWith('- ')), /★.*12:30.*午觉/)
console.log('PASS "中午" -> 11:00-14:00 window picks the nap')
await runtime.shutdown()
server.close()
