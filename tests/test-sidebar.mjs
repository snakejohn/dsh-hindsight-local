import assert from 'node:assert/strict'
import { sidebarStatus, createRpcHandler, recentLines } from '../lib/rpc.js'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildRuntime, createFakeClient, buildSession, createFakeAgent } from './harness.mjs'
let pass = 0
const base = (svc, cfg = {}) => ({ config: { enabled: true, setup: 'remote', service: { mode: 'external' }, bank: {}, ...cfg },
  runtime: { service: svc, recent: [{ at: '2026-10-24T01:00:00Z', bank: 'ws-a' }], activity: { lastRetain: '2026-10-24T02:00:00Z', lastRecall: '2026-10-24T02:05:00Z' }, client: { stats: async () => ({ pending_operations: 3 }) } } })
const t = async (n, f) => { await f(); pass++; console.log('ok', n) }
await t('green + bank + queue + times', async () => {
  const v = await sidebarStatus(base({ ready: true }))
  assert.equal(v.level, 'green'); assert.equal(v.bank, 'ws-a'); assert.equal(v.pending, 3)
  assert.equal(v.lastRetain, '2026-10-24T02:00:00Z'); assert.equal(v.lastRecall, '2026-10-24T02:05:00Z')
})
await t('gray when unset+auto', async () => {
  const v = await sidebarStatus(base({ ready: false, state: 'degraded' }, { setup: 'unset', service: { mode: 'auto' } }))
  assert.equal(v.level, 'gray'); assert.equal(v.setup, true, 'card opens the settings tab')
  assert.match(v.reason, /一键开始/)
  const done = await sidebarStatus(base({ ready: true }, { setup: 'local', service: { mode: 'local' } }))
  assert.equal(done.setup, false)
})
await t('an old 401 in the server log does not stick (only the last 10 minutes count)', async () => {
  const now = Date.parse('2026-10-25T20:30:00')
  const log = '2026-10-25 20:00:01,000 - ERROR - x - Auth error (HTTP 401) Unauthorized\n  traceback\n2026-10-25 20:29:00,000 - INFO - ok'
  assert.deepEqual(recentLines(log, { now }), ['2026-10-25 20:29:00,000 - INFO - ok'])
  assert.equal(recentLines(log, { now: Date.parse('2026-10-25T20:05:00') }).length, 3)
})
await t('yellow with progress while deploying', async () => {
  const v = await sidebarStatus(base({ ready: false, state: 'starting', deploy: { steps: [{ id: 'python', status: 'done' }, { id: 'install', status: 'running', detail: 'pip 40%' }, { id: 'start' }] } }, { setup: 'local' }))
  assert.equal(v.level, 'yellow'); assert.deepEqual(v.progress, { done: 1, total: 3, step: 'install', detail: 'pip 40%' })
})
await t('red with reason', async () => {
  const v = await sidebarStatus(base({ ready: false, state: 'degraded', lastError: 'Hindsight 进程已退出 (code=1)\nmore' }))
  assert.equal(v.level, 'red'); assert.equal(v.reason, 'Hindsight 进程已退出 (code=1)')
})
await t('long-poll returns on change', async () => {
  const cur = base({ ready: true })
  const rpc = createRpcHandler({ ctx: {}, current: () => cur })
  const call = async (p) => { const r = await rpc('sidebar', p); return r.data ?? r.result ?? r.value ?? r }
  const first = await call({})
  setTimeout(() => { cur.runtime.service.ready = false; cur.runtime.service.state = 'degraded'; cur.runtime.service.lastError = 'x' }, 300)
  const t0 = Date.now(); const next = await call({ since: first.sig, wait: true })
  assert.equal(next.level, 'red'); assert.ok(Date.now() - t0 < 5000)
})
console.log(`${pass} passed`)

await t('last retain/recall persisted, retain counts only when the operation completed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-'))
  const client = createFakeClient()
  const ops = new Map()
  client.retain = async () => { ops.set('op1', 'pending'); return { operation_id: 'op1' } }
  client.operation = async (b, id) => ({ status: ops.get(id) })
  const { runtime, config } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: dir } } })
  let v = await sidebarStatus({ runtime, config: { ...config, enabled: true } })
  assert.equal(v.lastRetain, ''); assert.equal(v.lastRecall, '')
  await runtime.retainAgent(createFakeAgent({ session: buildSession({ id: 'sb1', turns: [{ user: '我今天早上七点去公园跑了五公里，感觉很好', assistant: '真棒，坚持下去！' }] }) }))
  v = await sidebarStatus({ runtime, config: { ...config, enabled: true } })
  assert.equal(v.lastRetain, '', 'submitted is not remembered yet')
  ops.set('op1', 'completed'); await runtime.ops.poll()
  v = await sidebarStatus({ runtime, config: { ...config, enabled: true } })
  assert.ok(v.lastRetain, 'set once the extraction finished')
  runtime.markActivity('lastRecall')
  const { runtime: again } = buildRuntime({ fakeClient: createFakeClient(), rawConfig: { retain: { state_dir: dir } } })
  const v2 = await sidebarStatus({ runtime: again, config: { ...config, enabled: true } })
  assert.equal(v2.lastRetain, v.lastRetain, 'survives a dsh restart'); assert.ok(v2.lastRecall)
  assert.ok(JSON.parse(readFileSync(join(dir, '_activity.json'), 'utf8')).lastRetain)
})
await t('panel shows 还没有 instead of a dash', async () => {
  const src = readFileSync(new URL('../web/client.js', import.meta.url), 'utf8')
  assert.match(src, /return "还没有"/)
  assert.ok(!/if \(!iso\) return "—"/.test(src))
})
console.log(`${pass} passed`)
