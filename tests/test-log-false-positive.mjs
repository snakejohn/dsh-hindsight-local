// Regression: the sidebar showed 向量模型报错 / 密钥无效（401/403） for a healthy service,
// because bare 401/403/429 matched timestamp milliseconds (`16:52:35,403`) or
// `thoughts_tokens=401` in INFO lines. Only WARNING/ERROR lines (and tracebacks) count now,
// and status codes need context. Uses a real hindsight.log when present (no keys in it).
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { embeddingErrorFromLog, upstreamFromLog, errorLogLines, classifyEmbeddingError } from '../lib/embhealth.js'
import { recentLines, sidebarStatus } from '../lib/rpc.js'
let pass = 0
const ok = (n) => { pass++; console.log('ok', n) }

// The three real lines from the report.
const REAL_INFO = [
  "2026-11-02 16:52:35,403 - INFO - hindsight_api.engine.consolidation.consolidator - [CONSOLIDATION] bank=dsh-ungrouped-b2846d0a llm_batch #4 (5 memories, 1 llm calls) | processed=26/26 | recall=0",
  '2026-11-02 16:25:57,401 - INFO - root - Worker id: PF251Z33 (source: hostname (default))',
  '2026-11-02 16:16:37,136 - INFO - hindsight_api.engine.providers.openai_compatible_llm - slow llm call: scope=retain_extract_facts, model=openai/x/deepseek-v4.1-flash-1017, input_tokens=3598, output_tokens=625, total_tokens=4223, cached_tokens=3456, thoughts_tokens=401, time=38.179s',
  '2026-10-29 07:24:59,429 - INFO - hindsight_api.engine.memory_engine - Large batch detected (14,709 tokens from 1 items).',
  '2026-10-29 07:24:45,101 - INFO - openai._base_client - Retrying request to /embeddings in 0.429450 seconds'
]
for (const l of REAL_INFO) {
  assert.equal(embeddingErrorFromLog([l]), null, l)
  assert.deepEqual(upstreamFromLog([l]), { auth: false, rateLimit: false, emb: null }, l)
}
assert.equal(embeddingErrorFromLog(REAL_INFO), null)
ok('real INFO lines with ,401 / ,403 / ,429 / thoughts_tokens=401 → null')

// Even at WARNING level, a bare number in a timestamp or a counter is not a status code.
assert.equal(embeddingErrorFromLog(['2026-11-02 16:52:35,403 - WARNING - x - slow call thoughts_tokens=401 task=429']), null)
ok('bare 401/403/429 without context in a WARNING line → null')

// Real failures are still detected.
const AUTH = [
  '2026-11-02 17:00:01,000 - ERROR - hindsight_api.engine.memory_engine - Task execution failed: batch_retain',
  'Traceback (most recent call last):',
  '  File "x.py", line 1, in <module>',
  "openai.AuthenticationError: Error code: 401 - {'code': 30014, 'message': 'Invalid token', 'data': None}"
]
assert.match(embeddingErrorFromLog(AUTH).reason, /401/)
assert.equal(upstreamFromLog(AUTH).auth, true)
// Traceback continuation at the very start of the window (header cut off) still counts.
assert.equal(upstreamFromLog(AUTH.slice(2)).auth, true)
assert.equal(upstreamFromLog(["2026-11-02 17:00:01,000 - ERROR - x - embeddings failed: Error code: 403 - {'message': 'Forbidden'}"]).auth, true)
ok('Error code: 401 … Invalid token / 403 Forbidden still → 密钥无效')

const DIM = ["2026-11-02 17:00:02,000 - ERROR - hindsight_api.engine.embeddings - Failed to generate batch embeddings: Error code: 400 - {'code': 20015, 'message': 'The parameter is invalid. Please check again.', 'data': None}"]
assert.match(embeddingErrorFromLog(DIM).reason, /dimensions/)
assert.equal(upstreamFromLog(DIM).auth, false)
assert.equal(embeddingErrorFromLog(['2026-11-02 17:00:02,000 - INFO - x - processed 20015 rows']), null)
ok('SiliconFlow 400/20015 still → 参数错误')

const RL = [
  "2026-11-02 17:00:03,000 - WARNING - hindsight_api.worker.poller - Task t1 scheduled for retry: Exception: Failed to generate batch embeddings: Error code: 429 - {'code': 50603, 'message': 'System is too busy now. Please try again later.'}",
  '2026-11-02 17:00:04,000 - ERROR - x - openai.RateLimitError: Rate limit reached for requests'
]
for (const l of RL) {
  assert.match(embeddingErrorFromLog([l]).reason, /429/, l)
  const u = upstreamFromLog([l]); assert.equal(u.rateLimit, true, l); assert.equal(u.auth, false)
}
assert.equal(upstreamFromLog(['2026-11-02 17:00:05,000 - ERROR - x - HTTP 429 Too Many Requests']).rateLimit, true)
ok('real 429 / rate limit lines still → 限流')

// Loose mode (plugin's own probe responses) unchanged.
assert.match(classifyEmbeddingError('Token is invalid HTTP 401').reason, /401/)
assert.match(classifyEmbeddingError(' {} HTTP 403').reason, /401/)
assert.match(classifyEmbeddingError(' {} HTTP 429').reason, /429/)
ok('probe (loose) classification unchanged')

// INFO continuation lines (multi-line INFO messages) are ignored.
assert.deepEqual(errorLogLines(['2026-11-02 16:54:11,861 - INFO - x - ', '[RECALL] Complete: 401 facts 403 tok Error: none']), [])
ok('INFO continuation lines ignored')

// Replay the real log: every 40-line tail window around 16:5x and the sidebar stays green.
const realLog = '/workspace/issue-logs-1102/hindsight.log'
const fixture = existsSync(realLog)
  ? readFileSync(realLog, 'utf8')
  : [
      '2026-11-02 16:52:12,320 - INFO - hindsight_api.engine.providers.openai_compatible_llm - slow llm call: scope=consolidation, thoughts_tokens=401',
      ...REAL_INFO.slice(0, 2),
      '2026-11-02 16:52:35,426 - INFO - hindsight_api.engine.consolidation.consolidator - ',
      '  timing: 403ms total 429 rows',
      '2026-11-02 16:53:23,181 - INFO - hindsight_api.worker.poller - [WORKER_STATS] worker=PF251Z33 slots=0/1',
      '2026-11-02 16:55:23,961 - INFO - hindsight_api.worker.poller - [WORKER_STATS] worker=PF251Z33 slots=0/1'
    ].join('\n')
const all = fixture.split('\n')
for (const at of ['16:52:36', '16:53:00', '16:53:30', '16:54:30', '16:55:00', '16:55:30']) {
  const now = Date.parse(`2026-11-02T${at}`)
  const upto = all.filter((l) => { const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(l); return !m || Date.parse(`${m[1]}T${m[2]}`) <= now })
  const tail = upto.slice(-40)
  const recent = recentLines(tail.join('\n'), { now })
  assert.ok(recent.length > 0, at)
  assert.equal(embeddingErrorFromLog(recent), null, at)
  assert.deepEqual(upstreamFromLog(recent), { auth: false, rateLimit: false, emb: null }, at)
}
ok(`replayed tail windows 16:52–16:55 of ${existsSync(realLog) ? 'the real log' : 'the fixture'} → no warning`)

// End to end: sidebarStatus with that tail as the server log stays 记忆正常.
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fp-'))
  const logFile = join(dir, 'hindsight.log')
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  writeFileSync(logFile, [
    `${ts},403 - INFO - hindsight_api.engine.consolidation.consolidator - [CONSOLIDATION] llm_batch #4 processed=26/26`,
    `${ts},401 - INFO - root - Worker id: PF251Z33 (source: hostname (default))`,
    `${ts},429 - INFO - x - slow llm call: thoughts_tokens=401, time=38.179s`
  ].join('\n') + '\n')
  const st = await sidebarStatus({
    config: { enabled: true, setup: 'remote', service: { mode: 'external' }, bank: {} },
    runtime: { service: { ready: true, deploy: { serverLog: logFile } }, recent: [], activity: {}, client: { stats: async () => ({}) } }
  })
  assert.equal(st.level, 'green', JSON.stringify(st))
  assert.equal(st.text, '记忆正常')
  writeFileSync(logFile, `${ts},000 - ERROR - x - openai.AuthenticationError: Error code: 401 - {'message': 'Invalid token'}\n`)
  const bad = await sidebarStatus({
    config: { enabled: true, setup: 'remote', service: { mode: 'external' }, bank: {} },
    runtime: { service: { ready: true, deploy: { serverLog: logFile } }, recent: [], activity: {}, client: { stats: async () => ({}) } }
  })
  assert.equal(bad.level, 'yellow')
  assert.match(`${bad.text} ${bad.reason}`, /401|密钥/)
  ok('sidebarStatus: INFO lines with ,401/,403 stay 记忆正常; real 401 still warns')
}
console.log(`\n${pass} passed`)
