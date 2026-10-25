// 「重试失败项」 must not POST /retry for ops Hindsight is still running (HTTP 409), and a
// revoked key (401) must read 密钥无效或已失效, not 限流/连不上.
import assert from 'node:assert/strict'
import { OpTracker, zhReason, busyStatusFrom409 } from '../lib/ops.js'
import { explainFailure } from '../lib/deploy.js'

const quiet = { info() {}, warn() {}, debug() {} }
let pass = 0
const ok = (n) => { pass++; console.log('ok -', n) }

function client() {
  const ops = new Map()
  const c = {
    ops, posted: [],
    async operation(_b, id) { if (!ops.has(id)) { const e = new Error('404'); e.status = 404; throw e } return ops.get(id) },
    async retryOperation(_b, id) {
      c.posted.push(id)
      const o = ops.get(id)
      if (!['failed', 'cancelled', 'deferred'].includes(o.status)) {
        const e = new Error(`HTTP 409 POST .../retry -> {"detail":"Operation ${id} cannot be retried: status is '${o.status}', expected 'failed', 'cancelled' or deferred"}`); e.status = 409; throw e
      }
      o.status = 'pending'
    }
  }
  return c
}
const failedEntry = (id) => ({ id, bank: 'b', status: 'failed', attempts: 0, reason: '模型服务商限流或连不上', at: '2026-10-24T00:00:00Z' })

{
  assert.equal(zhReason("openai.AuthenticationError: Error code: 401 - {'code': 30014, 'message': 'Token is invalid.'}"), '密钥无效或已失效')
  assert.equal(zhReason('Application startup failed ... Error code: 401 ... Connection error'), '密钥无效或已失效')
  assert.equal(zhReason('Error code: 403 Forbidden'), '密钥无效或已失效')
  assert.equal(zhReason('APIConnectionError: Connection error.'), '模型服务商限流或连不上')
  assert.equal(zhReason('Error code: 429'), '模型服务商限流')
  const e = new Error("HTTP 409 -> cannot be retried: status is 'pending', expected 'failed'"); e.status = 409
  assert.equal(busyStatusFrom409(e), 'pending')
  assert.equal(busyStatusFrom409({ status: 409, message: 'other conflict' }), '')
  assert.equal(busyStatusFrom409({ status: 500, message: "status is 'pending'" }), '')
  const hint = explainFailure("openai.AuthenticationError: Error code: 401 - {'message': 'Token is invalid.'}\nApplication startup failed")
  assert.ok(String(Array.isArray(hint) ? hint.join() : hint).includes('密钥无效或已失效'))
  ok('401/403 -> 密钥无效或已失效; 409 busy detection')
}
{
  const c = client()
  const tr = new OpTracker({ client: c, logger: quiet })
  for (const [id, st] of [['p', 'pending'], ['r', 'processing'], ['f', 'failed'], ['x', 'cancelled'], ['d', 'deferred'], ['done', 'completed']]) {
    c.ops.set(id, { status: st }); tr.ops.set(id, failedEntry(id))
  }
  tr.ops.set('gone', failedEntry('gone'))
  const n = await tr.retryAll()
  assert.deepEqual(c.posted.sort(), ['d', 'f', 'x'], 'only failed/cancelled/deferred are POSTed')
  assert.equal(n, 3)
  assert.equal(tr.ops.get('p').status, 'pending'); assert.equal(tr.ops.get('r').status, 'processing')
  assert.ok(!tr.ops.has('done') && !tr.ops.has('gone'))
  const s = tr.summary()
  assert.equal(s.failed, 0, 'nothing left showing 失败'); assert.equal(s.processing, 5); assert.equal(s.completed, 1)
  ok('retryAll refreshes real status first and only retries failed/cancelled/deferred')
}
{
  // status refresh failed (network) but POST answers 409 pending -> not failed
  const c = client()
  c.operation = async () => { throw Object.assign(new Error('timeout'), { status: 0 }) }
  c.ops.set('p', { status: 'pending' })
  const tr = new OpTracker({ client: c, logger: quiet })
  tr.ops.set('p', failedEntry('p'))
  assert.equal(await tr.retryAll(), 0)
  assert.equal(tr.ops.get('p').status, 'pending'); assert.equal(tr.summary().failed, 0)
  ok('a 409 "status is pending/processing" is treated as 处理中, not failed')
}
{
  // stale failed entries are reconciled during polling, even with no retry budget left
  const c = client()
  let now = 1e9
  const tr = new OpTracker({ client: c, logger: quiet, now: () => now })
  c.ops.set('a', { status: 'processing' }); c.ops.set('b', { status: 'completed' }); c.ops.set('k', { status: 'failed', error_message: 'Error code: 401 Token is invalid' })
  for (const id of ['a', 'b', 'k']) tr.ops.set(id, failedEntry(id))
  await tr.poll()
  assert.equal(tr.ops.get('a').status, 'processing'); assert.ok(!tr.ops.has('b')); assert.equal(tr.ops.get('k').status, 'failed')
  assert.equal(c.posted.length, 0, 'reconcile never POSTs')
  await tr.retryAll()
  assert.equal(tr.ops.get('k').reason, '密钥无效或已失效', 'reason refreshed from the live error')
  ok('stale failed entries are reconciled; reason refreshed from live status')
}
console.log(`${pass} pass`)
