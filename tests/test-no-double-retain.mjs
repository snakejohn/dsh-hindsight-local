// Live finding (2026-10-25): a one-turn headless session produced two batch_retain ops for the
// same document_id. A pass arriving after agent/disposed (queued pass or ready-flush) used a fresh
// cursor (seq 0) and re-posted the turn. Same doc id => no duplicate memory, but a second LLM
// extraction. Now: disposed sessions read the persisted cursor, and an unchanged last turn is skipped.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildRuntime, createFakeClient, buildSession, createFakeAgent, createFakeCtx } from './harness.mjs'
let pass = 0
const ok = (n) => { pass++; console.log('ok -', n) }
const state_dir = mkdtempSync(join(tmpdir(), 'hs-cur-'))
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir } } })
  const session = buildSession({ id: 'session-dbl', turns: [{ user: '请记住我的小说主角叫林沙', assistant: '好的，记住了' }] })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: {} })
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 1 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1)
  ctx.emit('agent/disposed', { agent })
  // late passes after dispose: queued re-run, ready-flush, a second hook
  await runtime.retainAgent(agent); await runtime.retainAgent(agent)
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1, 'no second post after dispose'); ok('disposed session does not re-post the last turn')
}
{
  // A new runtime (next dsh start) on the same session, nothing changed: no re-send.
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir } } })
  const session = buildSession({ id: 'session-dbl', turns: [{ user: '请记住我的小说主角叫林沙', assistant: '好的，记住了' }] })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: {} }); runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 1 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 0, 'unchanged last turn skipped across restart'); ok('restart does not re-extract an unchanged turn')
}
{
  // Backend turns ready while a turn is still running: the flush must not post the half turn.
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { catchup_poll_ms: 1000 } } })
  let ready = false
  Object.defineProperty(runtime.service, 'ready', { get: () => ready, configurable: true })
  runtime.waitReady = async () => ready
  const session = buildSession({ id: 'mid-1', turns: [{ user: '测试：今天天气不错，只回复好的', assistant: '' }] })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: {} }); runtime.attach(ctx)
  ctx.emit('agent/created', { agent })
  runtime.retainState(agent)
  await runtime.onPreStep({ agent, turn: 1, messages: [] }, async () => ({ kind: 'enter', messages: [] }))
  ready = true
  await new Promise((r) => setTimeout(r, 2300)); await runtime.flush()
  assert.equal(client.calls.retain.length, 0, 'mid-turn flush skipped')
  ctx.emit('agent/turn-stopping', { agent, turn: 1 }); await runtime.flush()
  assert.equal(client.calls.retain.length, 1, 'turn retained once at turn end')
  await runtime.shutdown(); ok('ready-flush skips a running turn; turn end retains it once')
}
console.log(`\n${pass} passed`)
