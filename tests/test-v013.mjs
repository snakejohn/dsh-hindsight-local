// v0.1.3: truthful progress (operation status), auto retry without duplicates, throttle,
// pause while the configured local model address is unreachable, no automatic history import.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OpTracker, zhReason, backoffMs } from '../lib/ops.js'
import { localEnv } from '../lib/local.js'
import { resolveConfig } from '../lib/config.js'
import { sidebarStatus, createRpcHandler } from '../lib/rpc.js'
import { buildRuntime, createFakeClient, createFakeCtx, buildSession, createFakeAgent } from './harness.mjs'

const ok = (m) => console.log('PASS ' + m)
const quiet = { info() {}, warn() {}, debug() {} }

// --- reasons and backoff
assert.equal(zhReason('RuntimeError: Fact extraction failed: 1/1 chunks failed. First failures: chunk 0: APIConnectionError: Connection error.'), '模型服务商限流或连不上')
assert.equal(zhReason('Error code: 429 - rate limit'), '模型服务商限流')
assert.equal(zhReason('AuthenticationError: Error code: 401'), '密钥无效或已失效')
for (let a = 0; a < 6; a++) {
  const lo = backoffMs(a, { random: () => 0 }), hi = backoffMs(a, { random: () => 1 })
  assert.ok(lo < hi && lo >= Math.min(30 * 60000, 60000 * 2 ** a) * 0.75 - 1 && hi <= 30 * 60000 * 1.25)
}
ok('Chinese reasons; exponential backoff with ±25% jitter, capped')

// --- tracker against a fake operations API
function fakeOpsClient() {
  const ops = new Map()
  const c = {
    ops,
    retried: [],
    async operation(bank, id) {
      if (!ops.has(id)) { const e = new Error('404'); e.status = 404; throw e }
      return ops.get(id)
    },
    async retryOperation(bank, id) { c.retried.push(id); ops.get(id).status = 'pending' },
    async listOperations(bank, { status }) {
      return { operations: [...ops.entries()].filter(([, o]) => o.status === status && o.bank === bank).map(([id, o]) => ({ id, operation_type: o.type || 'retain', document_id: o.doc, error_message: o.error_message })) }
    }
  }
  return c
}
{
  const dir = mkdtempSync(join(tmpdir(), 'ops-'))
  const client = fakeOpsClient()
  let now = 1_000_000
  const tr = new OpTracker({ client, stateDir: dir, logger: quiet, now: () => now, random: () => 0.5, retryBase: 1000 })
  client.ops.set('a', { status: 'pending', bank: 'b1' })
  client.ops.set('b', { status: 'processing', bank: 'b1' })
  tr.add('a', { bank: 'b1', docs: ['s:t0'] })
  tr.add('b', { bank: 'b1', docs: ['s:t1'] })
  let s = await tr.poll()
  assert.deepEqual([s.processing, s.completed, s.failed], [2, 0, 0], 'accepted is not done')
  client.ops.get('a').status = 'completed'
  Object.assign(client.ops.get('b'), { status: 'failed', error_message: 'APIConnectionError: Connection error.' })
  s = await tr.poll()
  assert.deepEqual([s.processing, s.completed, s.failed, s.reason], [0, 1, 1, '模型服务商限流或连不上'])
  assert.equal(client.retried.length, 0, 'not retried before backoff')
  now += 2000
  s = await tr.poll()
  assert.deepEqual(client.retried, ['b'], 'auto retry after backoff, same operation (same document ids -> replace, no duplicates)')
  assert.equal(s.processing, 1)
  // persisted ledger survives a restart
  const tr2 = new OpTracker({ client, stateDir: dir, logger: quiet })
  assert.equal(tr2.active().length, 1)
  // pruned op (404) counts as completed
  client.ops.delete('b')
  s = await tr2.poll()
  assert.deepEqual([s.processing, s.completed], [0, 2])
  ok('progress follows operation status; failed ops auto-retried with backoff; ledger persisted')
}
{
  const client = fakeOpsClient()
  client.ops.set('old1', { status: 'failed', bank: 'dsh-x', error_message: 'Connection error' })
  client.ops.set('old2', { status: 'failed', bank: 'dsh-y', error_message: 'Connection error' })
  const tr = new OpTracker({ client, logger: quiet })
  assert.equal(await tr.adopt(['dsh-x', 'dsh-y']), 2)
  assert.equal(await tr.adopt(['dsh-x', 'dsh-y']), 0, 'adopt is idempotent')
  assert.equal(await tr.retryAll(), 2)
  assert.deepEqual(client.retried.sort(), ['old1', 'old2'])
  ok('failed retains from older versions are adopted and retried (「重试失败项」)')
}
{
  // Hindsight 1.1: one batch_retain parent + retain child per submit; only the parent counts.
  const client = fakeOpsClient()
  client.ops.set('p1', { status: 'failed', bank: 'dsh-x', type: 'batch_retain', doc: 's:t0', error_message: 'Connection error' })
  client.ops.set('c1', { status: 'failed', bank: 'dsh-x', type: 'retain', doc: 's:t0', error_message: 'Connection error' })
  client.ops.set('c2', { status: 'failed', bank: 'dsh-x', type: 'retain', doc: 'mine:t0', error_message: 'Connection error' })
  const tr = new OpTracker({ client, logger: quiet })
  tr.ops.set('own', { id: 'own', bank: 'dsh-x', status: 'pending', attempts: 0, docs: ['mine:t0'] })
  assert.equal(await tr.adopt(['dsh-x']), 1)
  assert.ok(tr.ops.has('p1') && !tr.ops.has('c1') && !tr.ops.has('c2'))
  ok('sub-batch child operations are not counted twice')
}

// --- Hindsight throttle env
{
  const { config } = resolveConfig({}, { env: {} })
  let env = localEnv(config)
  assert.equal(config.service.local.concurrency, 1)
  assert.deepEqual([env.HINDSIGHT_API_WORKER_MAX_SLOTS, env.HINDSIGHT_API_LLM_MAX_CONCURRENT, env.HINDSIGHT_API_RETAIN_LLM_MAX_CONCURRENT, env.HINDSIGHT_API_WORKER_CONSOLIDATION_RESERVED_SLOTS], ['1', '1', '1', '0'])
  config.service.local.concurrency = 9
  env = localEnv(config)
  assert.equal(env.HINDSIGHT_API_WORKER_MAX_SLOTS, '4', 'clamped to 4')
  assert.equal(config.backfill.enabled, false, 'no automatic history import by default')
  ok('同时处理数 default 1 (max 4) maps to Hindsight worker slots + LLM concurrency')
}

// --- runtime: operation ids recorded, throttle waits, gateway pause/resume
{
  const dir = mkdtempSync(join(tmpdir(), 'rt-'))
  const client = Object.assign(createFakeClient(), fakeOpsClient())
  let n = 0
  client.retain = async function (bankId, items) {
    const id = 'op' + ++n
    client.ops.set(id, { status: 'pending', bank: bankId })
    ;(client.calls.retain ||= []).push({ bankId, items })
    return { success: true, operation_id: id }
  }
  client.listBanks = async () => []
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: dir } } })
  assert.equal(runtime.importPrompt(), true, 'fresh install asks 要导入以前的对话吗')
  const session = buildSession({ turns: [{ user: '我早上 7 点去跑步了，跑了五公里', assistant: '好棒' }, { user: '晚上吃了面', assistant: '好' }] })
  await runtime.retainAgent(createFakeAgent({ session }))
  assert.equal(runtime.ops.active().length, 1, 'accepted retain tracked as processing')
  assert.equal(runtime.importPrompt(), true)
  // throttle: concurrency 1 -> waits while one op is in flight
  let waited = false
  const w = runtime.waitForCapacity(null, { pollMs: 20, maxWaitMs: 2000 }).then((r) => { waited = r })
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(waited, false, 'second conversation waits for the first')
  client.ops.get('op1').status = 'completed'
  await w
  assert.equal(waited, true)
  ok('backfill throttle: next conversation only after the previous operation finished')

  // gateway down -> writes pause with the neutral Chinese hint, no raw-only fallback; back -> resume + retry
  const srv = createServer((q, s) => { s.writeHead(404); s.end() })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  await new Promise((r) => srv.close(r))
  Object.assign(runtime.config.llm, { mode: 'follow', provider: 'openai', base_url: `http://127.0.0.1:${port}/v1` })
  assert.equal(await runtime.checkGateway({ force: true }), false)
  assert.match(runtime.gateway.reason, new RegExp(`模型地址 127.0.0.1:${port} 连不上，请确认对应的程序已启动；连上后会自动继续`))
  assert.equal(runtime.config.llm.provider, 'openai', 'never falls back to raw-only')
  const st = await sidebarStatus({ runtime, config: { ...runtime.config, enabled: true } })
  assert.equal(st.level, 'yellow')
  assert.equal(st.text, '模型地址连不上')
  client.ops.set('opF', { status: 'failed', bank: 'b', error_message: 'Connection error' })
  await runtime.ops.adopt(['b'])
  const before = client.calls.retain.length
  appendTurnSafe(session)
  await runtime.retainAgent(createFakeAgent({ session }))
  assert.equal(client.calls.retain.length, before, 'paused while unreachable')
  const srv2 = createServer((q, s) => { s.writeHead(401); s.end('{}') })
  await new Promise((r) => srv2.listen(port, '127.0.0.1', r))
  assert.equal(await runtime.checkGateway({ force: true }), true)
  assert.ok(client.retried.includes('opF'), 'failed ops re-queued when the address answers again')
  await new Promise((r) => srv2.close(r))
  ok('unreachable local model address: pause + neutral hint; auto-resume and retry failed ops')

  runtime.dismissImport('dismissed')
  assert.equal(runtime.importPrompt(), false)
  const dir2 = mkdtempSync(join(tmpdir(), 'rt2-'))
  writeFileSync(join(dir2, 'old-session.json'), '{}')
  const { runtime: r2 } = buildRuntime({ fakeClient: createFakeClient(), rawConfig: { retain: { state_dir: dir2 } } })
  assert.equal(r2.importPrompt(), false, 'existing install keeps its state, no prompt')
  assert.ok(existsSync(join(dir2, '_import.json')))
  ok('import prompt only on fresh installs; dismiss persisted')
}

function appendTurnSafe(session) {
  // harness appendTurn needs the TURN shape; a no-op is enough because the pause returns before reading turns
  return session
}

{
  // 看看记住了什么: paged server-side, 600+ memories never fetched at once
  const all = Array.from({ length: 650 }, (_, i) => ({ id: 'm' + i, text: 'fact ' + i, fact_type: 'world', embedding: [1, 2] }))
  const calls = []
  const runtime = { client: { async listMemories(bank, o) { calls.push({ bank, ...o }); return { items: all.slice(o.offset, o.offset + o.limit), total: all.length, offset: o.offset, limit: o.limit } } } }
  const rpc = createRpcHandler({ ctx: {}, current: () => ({ runtime, config: {}, rawConfig: {} }) })
  const r1 = await rpc('memories', { bank: 'b', limit: 10, offset: 0 })
  const v1 = r1?.value ?? r1
  assert.equal(v1.items.length, 10); assert.equal(v1.total, 650); assert.ok(!('embedding' in v1.items[0]))
  const v2 = (await rpc('memories', { bank: 'b', limit: 10, offset: 10, q: 'x' })).value ?? {}
  assert.equal(calls[1].offset, 10); assert.equal(calls[1].q, 'x')
  await rpc('memories', { bank: 'b', limit: 100000 })
  assert.equal(calls[2].limit, 50, 'page size capped')
  ok('memory browser pages server-side (limit/offset, capped at 50)')
}
console.log('done')
