/** v0.1.1 fixes: PID wait, LLM timeout, retain chunking, UTC-midnight times, saved-key hint, zh 24h time. No key needed. */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HINDSIGHT_LOG_DIR ||= mkdtempSync(join(tmpdir(), 'hs-v011-'))
const { waitPreviousInstance, pidAlive } = await import('../lib/lifecycle.js')
const { localEnv } = await import('../lib/local.js')
const { isUtcMidnight, resultTime, selectResults } = await import('../lib/recall.js')
const { createRpcHandler } = await import('../lib/rpc.js')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))

// 1. PID wait
{
  const f = join(mkdtempSync(join(tmpdir(), 'pid-')), 'hindsight.pid')
  assert.deepEqual(await waitPreviousInstance({ pidFile: f }), { waited: false })
  writeFileSync(f, '4242')
  let n = 0
  const r = await waitPreviousInstance({ pidFile: f, alive: () => ++n < 3, sleepMs: 5 })
  assert.equal(r.timedOut, false); assert.equal(n, 3); assert.equal(existsSync(f), false)
  writeFileSync(f, '4242')
  const t = await waitPreviousInstance({ pidFile: f, alive: () => true, timeoutMs: 30, sleepMs: 5 })
  assert.equal(t.timedOut, true)
  assert.equal(pidAlive(0), false); assert.equal(pidAlive('x'), false)
  console.log('PASS waitPreviousInstance waits for / times out on the old instance')
}
// 2+6. timeouts and retain chunking
{
  const base = { service: { local: {} }, embedding: { provider: 'openai', api_key: 'x' }, reranker: {}, llm: { provider: 'openai', api_key: 'y' } }
  const e = localEnv(base)
  assert.equal(e.HINDSIGHT_API_LLM_TIMEOUT, '300')
  assert.equal(e.HINDSIGHT_API_RETAIN_CHUNK_SIZE, '1500')
  assert.equal(e.HINDSIGHT_API_RETAIN_MAX_COMPLETION_TOKENS, '8000')
  const o = localEnv({ ...base, service: { local: { llm_timeout: 600, retain_chunk_size: 4000, retain_max_completion_tokens: 2000 } } })
  assert.equal(o.HINDSIGHT_API_LLM_TIMEOUT, '600')
  assert.equal(o.HINDSIGHT_API_RETAIN_CHUNK_SIZE, '4000')
  assert.ok(Number(o.HINDSIGHT_API_RETAIN_MAX_COMPLETION_TOKENS) > 4000, 'max tokens must exceed chunk size')
  console.log('PASS LLM timeout 300s + configurable retain chunk / max completion tokens')
}
// 3. UTC-midnight
{
  assert.equal(isUtcMidnight('2026-10-23T00:00:00.010000+00:00'), true)
  assert.equal(isUtcMidnight('2026-10-23T00:00:00Z'), true)
  assert.equal(isUtcMidnight('2026-10-23T06:40:00+08:00'), false)
  const m = '2026-10-23T13:30:00+00:00'
  assert.equal(resultTime({ occurred_start: '2026-10-23T00:00:00.010000+00:00', mentioned_at: m }), Date.parse(m))
  assert.equal(resultTime({ occurred_start: '2026-10-22T22:40:00+00:00', mentioned_at: m }), Date.parse('2026-10-22T22:40:00Z'))
  // a date-only dinner fact (shown as 08:00 BJT before) must not hit a 07:00-08:00 morning window
  const win = { start: new Date('2026-10-23T07:00:00+08:00'), end: new Date('2026-10-23T09:00:00+08:00') }
  const sel = selectResults([{ text: 'dinner', occurred_start: '2026-10-23T00:00:00+00:00', mentioned_at: m, scores: { final: 0.5 } }], { recall: { top_n: 5 }, time: {} }, { window: win })
  assert.equal(sel[0].inWindow, false)
  console.log('PASS UTC-midnight date-only facts use the real turn time')
}
// 4. saved-key hint via overview.keysSet (booleans only)
{
  const runtime = { service: { ready: false, state: 'idle' }, stats: {}, job: null, recent: [], failures: [] }
  const config = { setup: 'local', enabled: true, service: { base_url: '', local: {} }, llm: { mode: 'follow' }, embedding: { api_key: 'sk-secret' }, reranker: {} }
  const rpc = createRpcHandler({ ctx: {}, current: () => ({ runtime, config, rawConfig: { embedding: { api_key: 'sk-secret' } } }) })
  const call = typeof rpc === 'function' ? rpc : (rpc.overview ? rpc.overview : null)
  const out = typeof rpc === 'function' ? await rpc('overview', {}) : await rpc.endpoints?.overview?.()
  const ov = out?.value ?? out?.result ?? out
  assert.deepEqual(ov.keysSet, { embedding: true, reranker: false, llm: false })
  assert.ok(!JSON.stringify(ov).includes('sk-secret'), 'overview must not leak the key')
  const client = readFileSync(new URL('../web/client.js', import.meta.url), 'utf8')
  assert.match(client, /ov\.keyState\.embedding/); assert.match(client, /ovS\.keyState\[chan\]/)
  console.log('PASS overview.keysSet drives the "已保存过密钥" placeholder without leaking the key')
}
// 5. zh 24h time + panel memTime
{
  const client = readFileSync(new URL('../web/client.js', import.meta.url), 'utf8')
  assert.match(client, /toLocaleString\("zh-CN", \{ hour12: false \}\)/)
  assert.match(client, /fmtTime\(memTime\(m\)\)/)
  assert.equal(new Date('2026-10-24T13:05:00+08:00').toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }), '2026/10/24 13:05:00')
  console.log('PASS panel shows zh-CN 24h time and the real time for date-only facts')
}
assert.match(pkg.version, /^0\.1\.[1-9]/)
console.log('\nv0.1.1 tests passed')
