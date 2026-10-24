import assert from 'node:assert/strict'
import { sidebarStatus, createRpcHandler } from '../lib/rpc.js'
let pass = 0
const base = (svc, cfg = {}) => ({ config: { enabled: true, setup: 'remote', service: { mode: 'external' }, bank: {}, ...cfg },
  runtime: { service: svc, recent: [{ at: '2026-10-24T02:00:00Z', bank: 'ws-a' }], lastRecall: { at: '2026-10-24T02:05:00Z' }, client: { stats: async () => ({ pending_operations: 3 }) } } })
const t = async (n, f) => { await f(); pass++; console.log('ok', n) }
await t('green + bank + queue + times', async () => {
  const v = await sidebarStatus(base({ ready: true }))
  assert.equal(v.level, 'green'); assert.equal(v.bank, 'ws-a'); assert.equal(v.pending, 3)
  assert.equal(v.lastRetain, '2026-10-24T02:00:00Z'); assert.equal(v.lastRecall, '2026-10-24T02:05:00Z')
})
await t('gray when unset+auto', async () => {
  const v = await sidebarStatus(base({ ready: false, state: 'degraded' }, { setup: 'unset', service: { mode: 'auto' } }))
  assert.equal(v.level, 'gray')
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
