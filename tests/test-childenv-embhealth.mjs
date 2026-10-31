/**
 * Child env isolation + truthful embedding status.
 * - Inherited HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS must not reach the child.
 * - Sidebar shows 向量模型报错 when the embedding probe / recent log says so.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hs-childenv-'))
const pluginRoot = join(root, 'plugin')
const home = join(root, 'home')
mkdirSync(pluginRoot); mkdirSync(home)
process.env.HOME = process.env.USERPROFILE = home
process.env.DSH_HINDSIGHT_PLUGIN_ROOT = pluginRoot
process.env.DSH_HINDSIGHT_LOG_DIR = join(root, 'logs')
process.env.DSH_HINDSIGHT_ENV_BACKUP = join(root, 'backup', 'plugin.env')

const { stripInheritedHindsight, scrubUnsetDimensions, isInheritedHindsightVar } = await import('../lib/childenv.js')
const { classifyEmbeddingError, embeddingErrorFromLog, probeEmbeddingHealth, createEmbHealthCache } = await import('../lib/embhealth.js')
const { sidebarStatus, recentLines } = await import('../lib/rpc.js')
const { syncDotenv, parseDotenv } = await import('../lib/dotenv.js')
const { zhReason } = await import('../lib/ops.js')
const { explainFailure } = await import('../lib/deploy.js')
const { HindsightService } = await import('../lib/lifecycle.js')
const { resolveConfig } = await import('../lib/config.js')
const { plainConfig } = await import('../lib/schema.js')

let pass = 0
const ok = (n) => { pass++; console.log('PASS', n) }

assert.equal(isInheritedHindsightVar('HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS'), true)
assert.equal(isInheritedHindsightVar('DSH_HINDSIGHT_EMBEDDING_DIM'), true)
assert.equal(isInheritedHindsightVar('PATH'), false)
assert.equal(isInheritedHindsightVar('HTTP_PROXY'), false)
const stripped = stripInheritedHindsight({
  PATH: '/usr/bin',
  HOME: home,
  HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS: '1024',
  HINDSIGHT_API_LLM_API_KEY: 'sk-should-drop',
  DSH_HINDSIGHT_EMBEDDING_DIM: '1024',
  NORMAL: 'keep'
})
assert.equal(stripped.env.PATH, '/usr/bin')
assert.equal(stripped.env.NORMAL, 'keep')
assert.equal(stripped.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS, undefined)
assert.equal(stripped.env.HINDSIGHT_API_LLM_API_KEY, undefined)
assert.ok(stripped.dropped.includes('HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS'))
assert.ok(stripped.dropped.includes('HINDSIGHT_API_LLM_API_KEY'))
ok('stripInheritedHindsight drops HINDSIGHT_* / DSH_HINDSIGHT_* without values in the log list')

const scrub = scrubUnsetDimensions(
  { HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS: '1024', HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: 'BAAI/bge-m3' },
  { HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: 'BAAI/bge-m3' }
)
assert.equal(scrub.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS, undefined)
assert.equal(scrub.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, 'BAAI/bge-m3')
assert.deepEqual(scrub.cleared, ['HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS'])
ok('scrubUnsetDimensions removes stale DIMENSIONS when panel leaves it empty')

const envPath = join(pluginRoot, '.env')
writeFileSync(envPath, "HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS=1024\nHINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL=BAAI/bge-m3\n")
const synced = syncDotenv({ HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: 'BAAI/bge-m3', DSH_HINDSIGHT_EMBEDDING_DIM: '1024' }, { path: envPath })
assert.equal(synced.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS, undefined)
assert.equal(synced.env.DSH_HINDSIGHT_EMBEDDING_DIM, '1024')
assert.ok(!parseDotenv(readFileSync(envPath, 'utf8')).HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS)
ok('syncDotenv clears stale DIMENSIONS from plugin .env; DSH_HINDSIGHT_EMBEDDING_DIM kept')

assert.equal(classifyEmbeddingError('Error code: 20015 Invalid parameter dimensions').text, '向量模型报错')
assert.match(classifyEmbeddingError('Error code: 20015').reason, /参数错误/)
assert.equal(classifyEmbeddingError('Token is invalid HTTP 401').reason.includes('401'), true)
assert.equal(classifyEmbeddingError('unrelated info line'), null)
assert.equal(zhReason('HTTP 400 code 20015 does not support dimensions'), '向量模型报错')
assert.match(explainFailure('Error code: 20015 Invalid parameter'), /向量模型参数错误|dimensions/)
ok('classifyEmbeddingError / zhReason / explainFailure cover 20015')

const fakeFail = async () => ({
  ok: false, status: 400,
  text: async () => JSON.stringify({ code: 20015, message: 'Invalid parameter dimensions' })
})
// probeEmbeddingDim uses res.ok / res.text — fake must match
const badFetch = async () => ({
  ok: false, status: 400,
  text: async () => '{"code":20015,"message":"Invalid parameter dimensions"}'
})
const bad = await probeEmbeddingHealth({
  provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'sk-x', model: 'BAAI/bge-m3',
  dimensions: 1024, fetchImpl: badFetch
})
assert.equal(bad.ok, false)
assert.equal(bad.text, '向量模型报错')
assert.match(bad.reason, /参数错误|400/)
ok('probeEmbeddingHealth reports 向量模型报错 on 400/20015')

const goodFetch = async (url, init) => {
  const body = JSON.parse(init.body)
  assert.equal(body.dimensions, undefined, 'health probe must not send dimensions by default')
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ embedding: new Array(1024).fill(0) }] }) }
}
const good = await probeEmbeddingHealth({
  provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'sk-x', model: 'BAAI/bge-m3',
  fetchImpl: goodFetch
})
assert.equal(good.ok, true)
assert.equal(good.dim, 1024)
ok('probeEmbeddingHealth succeeds without sending dimensions')

let calls = 0
const cache = createEmbHealthCache({
  ttlOk: 60_000, ttlFail: 60_000,
  probe: async () => { calls++; return { ok: false, text: '向量模型报错', reason: '密钥无效（401/403）', hint: '换密钥', at: new Date().toISOString() } }
})
const a = await cache.ensure({})
const b = await cache.ensure({})
assert.equal(calls, 1)
assert.equal(a.text, '向量模型报错')
assert.equal(b.reason, a.reason)
ok('emb health cache avoids repeat probes')

const now = Date.parse('2026-10-27T10:00:00')
const log = [
  '2026-10-27 09:55:00,000 - ERROR - embeddings failed: Error code: 20015 Invalid parameter dimensions',
  '2026-10-27 09:56:00,000 - ERROR - retain failed'
].join('\n')
const fromLog = embeddingErrorFromLog(recentLines(log, { now }))
assert.equal(fromLog.text, '向量模型报错')

const base = (svc, cfg = {}, runtimeExtra = {}) => ({
  config: { enabled: true, setup: 'local', service: { mode: 'local' }, ...cfg },
  runtime: {
    service: svc,
    recent: [],
    activity: {},
    client: { stats: async () => ({ pending_operations: 0 }) },
    ...runtimeExtra
  }
})

const green = await sidebarStatus(base({ ready: true, state: 'ready' }))
assert.equal(green.level, 'green')
assert.equal(green.text, '记忆正常')
ok('sidebar stays 记忆正常 when no embedding error')

const withProbe = {
  ready: true,
  state: 'ready',
  getEmbeddingHealth: () => ({ ok: false, text: '向量模型报错', reason: '参数错误（例如误传了 dimensions）', hint: '不要传 dimensions', at: 'x' }),
  refreshEmbHealth: async () => ({ ok: false, text: '向量模型报错', reason: '参数错误（例如误传了 dimensions）', hint: '不要传 dimensions', at: 'x' })
}
const badStatus = await sidebarStatus(base(withProbe))
assert.equal(badStatus.level, 'yellow')
assert.equal(badStatus.text, '向量模型报错')
assert.match(badStatus.reason, /参数错误/)
ok('sidebar shows 向量模型报错 from embedding probe')

const logDir = join(root, 'logs'); mkdirSync(logDir, { recursive: true })
const logFile = join(logDir, 'hindsight-emb.log')
const d = new Date(Date.now() - 60_000) // 1 minute ago, inside the 10-minute window
const pad = (n) => String(n).padStart(2, '0')
const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
writeFileSync(logFile, `${ts},000 - ERROR - Error code: 20015 Invalid parameter dimensions\n`)
const fromServerLog = await sidebarStatus(base({
  ready: true, state: 'ready',
  deploy: { serverLog: logFile }
}))
assert.equal(fromServerLog.text, '向量模型报错')
ok('sidebar shows 向量模型报错 from recent server log (10-minute window)')

// End-to-end spawn: inherited DIMENSIONS must not appear in the child's env dump.
const bin = join(root, 'bin'); mkdirSync(bin)
const DUMP = join(root, 'dump.json')
writeFileSync(join(bin, 'hindsight-api'), `#!/usr/bin/env node
const fs = require('fs')
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(HINDSIGHT_|DSH_HINDSIGHT_|PATH$)/.test(k)))
fs.writeFileSync(${JSON.stringify(DUMP)}, JSON.stringify({ env, cwd: process.cwd() }))
setInterval(() => {}, 1000)
`)
chmodSync(join(bin, 'hindsight-api'), 0o755)
process.env.PATH = `${bin}:${process.env.PATH}`
process.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS = '1024'
process.env.HINDSIGHT_API_SHOULD_NOT_LEAK = 'secret-value'

const volatile = (v) => Object.freeze({ get: () => Object.freeze(JSON.parse(JSON.stringify(v))), [Symbol.for('cosmokit.volatile.write')]: () => {} })
const panel = {
  setup: 'local',
  service: { local: { runner: 'pip', port: 18666 }, startup_timeout_ms: 4000, health_interval_ms: 100, health_timeout_ms: 200, shutdown_grace_ms: 300 },
  embedding: { provider: 'openai', base_url: 'https://api.siliconflow.cn/v1', api_key: 'sk-emb', model: 'BAAI/bge-m3', expected_dim: 1024, dimensions: 0 },
  reranker: { provider: '' },
  llm: { mode: 'none', provider: 'none' }
}
const config = resolveConfig(plainConfig(volatile(panel)), { env: {} }).config
const logs = []
const logger = { debug: (m) => logs.push(['debug', m]), info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) }
const client = {
  async health() { return existsSync(DUMP) ? { ok: true, status: 200 } : { ok: false, status: 0, error: 'ECONNREFUSED' } },
  async version() { return { api_version: '1.1.0' } },
  async ensureBank(id) { return { bankId: id } }
}
const runner = async (cmd) => cmd === 'hindsight-api' ? { ok: true, code: 0, stdout: '1.1.0', stderr: '' } : { ok: false, code: 1, stdout: '', stderr: 'not found' }
const s = new HindsightService({ config, logger, client, runner })
// Skip real embedding dim probe (would hit network): disable via config
s.config.service.local.dim_probe = false
try { unlinkSync(DUMP) } catch {}
const ready = await s.ensureReady('test')
for (let i = 0; i < 50 && !existsSync(DUMP); i++) await new Promise((r) => setTimeout(r, 100))
assert.equal(ready, true, JSON.stringify(s.deploy))
const dump = JSON.parse(readFileSync(DUMP, 'utf8'))
assert.equal(dump.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS, undefined, 'inherited DIMENSIONS must not reach child')
assert.equal(dump.env.HINDSIGHT_API_SHOULD_NOT_LEAK, undefined)
assert.equal(dump.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, 'BAAI/bge-m3')
assert.equal(dump.env.DSH_HINDSIGHT_EMBEDDING_DIM, '1024', 'plugin expected_dim guard still set')
const dropLog = logs.find(([, m]) => /dropped inherited Hindsight env vars/.test(m))
assert.ok(dropLog, 'should log which inherited vars were dropped')
assert.match(dropLog[1], /HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS/)
assert.ok(!dropLog[1].includes('1024'), 'must not log the value')
assert.ok(!dropLog[1].includes('secret-value'), 'must not log other dropped values')
const runEnv = join(home, '.dsh-hindsight', 'run', '.env')
assert.ok(existsSync(runEnv))
assert.ok(!parseDotenv(readFileSync(runEnv, 'utf8')).HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS, 'run .env must not carry DIMENSIONS')
await s.stop()
delete process.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS
delete process.env.HINDSIGHT_API_SHOULD_NOT_LEAK
ok('spawned child does not inherit DIMENSIONS; drop is logged without values; run .env scrubbed')

console.log(`${pass} pass`)

// Startup exit caused by embedding 400/20015: headline says 向量模型报错 (not only 出问题了).
{
  const { sidebarStatus } = await import('../lib/rpc.js')
  const st = await sidebarStatus({
    runtime: { service: { ready: false, state: 'failed', deploy: {}, lastError: 'Hindsight 进程已退出 (code=3)：向量模型参数错误（例如误传了 dimensions，硅基流动 bge-m3 会返回 400/20015）' } },
    config: { enabled: true, setup: 'local', embedding: { api_key: 'x' }, llm: { api_key: 'x' } }
  })
  assert.equal(st.level, 'red')
  assert.equal(st.text, '向量模型报错')
  assert.match(st.reason, /20015/)
  ok('startup exit on 400/20015 → sidebar headline 向量模型报错')
}
