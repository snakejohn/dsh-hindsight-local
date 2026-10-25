/**
 * Regression tests for "插件没有读到配置" and the local-deploy diagnostics:
 * panel config (dsh Volatile ref, as delivered after form.mutate → cordis.patch.yml →
 * loader/volatile-update) → plainConfig → resolveConfig → plugin-root .env → spawn env.
 * A fake `hindsight-api` on PATH dumps the env/cwd it actually received.
 * Run: node tests/test-dotenv-deploy.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hs-dotenv-'))
const pluginRoot = join(root, 'plugin')
process.env.HOME = process.env.USERPROFILE = join(root, 'home') // data root (~/.dsh-hindsight) under the temp dir
const bin = join(root, 'bin')
mkdirSync(pluginRoot); mkdirSync(bin)
process.env.DSH_HINDSIGHT_PLUGIN_ROOT = pluginRoot
process.env.DSH_HINDSIGHT_LOG_DIR = join(root, 'logs')
const DUMP = join(root, 'dump.json')
// Fake server: records what it was given; FAKE_MODE=crash mimics slim without embeddings.
writeFileSync(join(bin, 'hindsight-api'), `#!/usr/bin/env node
const fs = require('fs')
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(HINDSIGHT_|PYTHON|UV_)/.test(k)))
fs.writeFileSync(${JSON.stringify(DUMP)}, JSON.stringify({ env, cwd: process.cwd(), argv: process.argv.slice(2) }))
if (process.env.FAKE_MODE === 'crash') {
  console.log('Embeddings: provider=local')
  console.error('ImportError: sentence-transformers is required for LocalSTEmbeddings')
  console.error('ERROR:    Application startup failed. Exiting.')
  process.exit(3)
}
setInterval(() => {}, 1000)
`)
chmodSync(join(bin, 'hindsight-api'), 0o755)
process.env.PATH = `${bin}:${process.env.PATH}`

const { HindsightService } = await import('../lib/lifecycle.js')
const { resolveConfig } = await import('../lib/config.js')
const { plainConfig } = await import('../lib/schema.js')
const { parseDotenv, quoteValue, serializeDotenv, syncDotenv, maskedDotenv } = await import('../lib/dotenv.js')
const { preflightEnv, explainFailure, summarizeEnv } = await import('../lib/deploy.js')

let passed = 0
async function ok(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }
const logs = []
const logger = { debug: (m) => logs.push(['debug', m]), info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) }
/** dsh hands the plugin a frozen Volatile root ref (cosmokit createVolatile). */
const volatile = (v) => Object.freeze({ get: () => Object.freeze(JSON.parse(JSON.stringify(v))), [Symbol.for('cosmokit.volatile.write')]: () => {} })
const health = { good: { ok: true, status: 200 }, bad: { ok: false, status: 0, error: 'ECONNREFUSED' } }
const runner = async (cmd, args) => {
  if (cmd === 'hindsight-api') return { ok: true, code: 0, stdout: '1.1.0', stderr: '' }
  return { ok: false, code: 1, stdout: '', stderr: 'not found' }
}
function service(panel, { plan = [health.bad, health.good] } = {}) {
  const config = resolveConfig(plainConfig(volatile(panel)), { env: {} }).config
  let i = 0
  const client = { async health() { return plan[Math.min(i++, plan.length - 1)] }, async version() { return { api_version: '1.1.0' } }, async ensureBank(id) { return { bankId: id } } }
  return new HindsightService({ config, logger, client, runner })
}
const PANEL = {
  setup: 'local',
  service: { local: { runner: 'pip', port: 18555 }, startup_timeout_ms: 4000, health_interval_ms: 100, health_timeout_ms: 200, shutdown_grace_ms: 300 },
  embedding: { provider: 'openai', base_url: 'https://api.siliconflow.cn/v1', api_key: 'sk-emb-123', model: 'BAAI/bge-m3' },
  reranker: { provider: '' },
  llm: { mode: 'custom', provider: 'deepseek', base_url: 'https://api.deepseek.com', api_key: 'sk-llm-456', model: 'deepseek-chat' }
}
import { unlinkSync, realpathSync } from 'node:fs'
const dump = () => JSON.parse(readFileSync(DUMP, 'utf8'))
async function started(s) { try { unlinkSync(DUMP) } catch {} ; const r = await s.ensureReady('test'); for (let i = 0; i < 50 && !existsSync(DUMP); i++) await new Promise((res) => setTimeout(res, 100)); return r }

await ok('dotenv: quoting round-trips Windows/Chinese paths, spaces, quotes; no BOM', () => {
  const vals = { A: 'plain', B: 'J:\\AI项目\\back', C: 'has space', D: "it's \"q\"", E: 'https://x.y/v1?a=b', F: 'BAAI/bge-m3' }
  const text = serializeDotenv(vals, 'hdr')
  assert.deepEqual(parseDotenv(text), vals)
  assert.equal(quoteValue('J:\\AI项目\\back'), "'J:\\AI项目\\back'")
  const r = syncDotenv({ HINDSIGHT_API_X: 'v' }, { path: join(root, 'bom.env') })
  assert.ok(r.written)
  const buf = readFileSync(join(root, 'bom.env'))
  assert.notDeepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.deepEqual(parseDotenv('\uFEFFK=v\r\nexport J="a\\nb" # c\n'), { K: 'v', J: 'a\nb' })
})

await ok('panel config (Volatile) → .env → child env: EMBEDDINGS_*/LLM_*/RERANKER correct, cwd = data root run dir (not the plugin dir)', async () => {
  const s = service(PANEL)
  assert.equal(await s.ensureReady("test"), true, JSON.stringify(s.deploy)); for (let i = 0; i < 50 && !existsSync(DUMP); i++) await new Promise((r) => setTimeout(r, 100))
  const d = dump()
  assert.equal(d.env.HINDSIGHT_API_EMBEDDINGS_PROVIDER, 'openai')
  assert.equal(d.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL, 'https://api.siliconflow.cn/v1')
  assert.equal(d.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, 'sk-emb-123')
  assert.equal(d.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, 'BAAI/bge-m3')
  assert.equal(d.env.HINDSIGHT_API_RERANKER_PROVIDER, 'rrf')
  assert.equal(d.env.HINDSIGHT_API_LLM_PROVIDER, 'deepseek')
  assert.equal(d.env.HINDSIGHT_API_LLM_API_KEY, 'sk-llm-456')
  assert.equal(d.env.HINDSIGHT_API_LLM_MODEL, 'deepseek-chat')
  assert.equal(d.env.PYTHONUTF8, '1')
  // Not the plugin install dir (Windows would lock it and block plugin updates); the run dir holds
  // a copy of our .env so hindsight-api's find_dotenv(usecwd) still finds OUR settings first.
  const runDir = join(root, 'home', '.dsh-hindsight', 'run')
  assert.equal(realpathSync(d.cwd), realpathSync(runDir))
  assert.ok(!realpathSync(d.cwd).startsWith(realpathSync(pluginRoot)))
  assert.equal(readFileSync(join(runDir, '.env'), 'utf8'), readFileSync(join(pluginRoot, '.env'), 'utf8'))
  assert.deepEqual(d.argv, ['--host', '127.0.0.1', '--port', '18555'])
  const file = parseDotenv(readFileSync(join(pluginRoot, '.env'), 'utf8'))
  assert.equal(file.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, 'sk-emb-123')
  assert.equal(file.HINDSIGHT_API_LLM_API_KEY, 'sk-llm-456')
  // Redacted config summary in plugin.log; never the key itself.
  const line = logs.find(([, m]) => m.startsWith('Hindsight config:'))
  assert.ok(line && /embeddings=\[openai BAAI\/bge-m3 https:\/\/api.siliconflow.cn\/v1 key \(已设置\)\]/.test(line[1]), line?.[1])
  assert.ok(!logs.some(([, m]) => m.includes('sk-emb-123') || m.includes('sk-llm-456')))
  const st = await s.deployStatus()
  assert.ok(st.pid > 0)
  assert.deepEqual(st.steps.map((x) => x.status), ['done', 'done', 'done', 'done', 'done'])
  await s.stop()
})

await ok('reload with blank (redacted) keys keeps the keys from .env; masked echo hides them', async () => {
  const s = service({ ...PANEL, embedding: { ...PANEL.embedding, api_key: '' }, llm: { ...PANEL.llm, api_key: '' } })
  assert.equal(await started(s), true)
  assert.equal(dump().env.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, 'sk-emb-123')
  assert.equal(dump().env.HINDSIGHT_API_LLM_API_KEY, 'sk-llm-456')
  const m = maskedDotenv()
  assert.ok(!JSON.stringify(m).includes('sk-emb-123'))
  assert.match(m.env.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, /已设置/)
  await s.stop()
})

await ok('hand-edited .env is used when the panel leaves fields empty', async () => {
  const p = join(pluginRoot, '.env')
  writeFileSync(p, readFileSync(p, 'utf8').replace(/HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL=.*/, "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL='Qwen/Qwen3 Embedding'"))
  const s = service({ ...PANEL, embedding: { provider: 'openai', model: '' } })
  assert.equal(await started(s), true)
  assert.equal(dump().env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, 'Qwen/Qwen3 Embedding')
  await s.stop()
})

await ok('follow mode: dsh key is injected but never written to .env', async () => {
  const p = join(pluginRoot, '.env')
  writeFileSync(p, readFileSync(p, 'utf8').replace(/HINDSIGHT_API_LLM_API_KEY=.*\n/, ''))
  const s = service({ ...PANEL, llm: { mode: 'follow', provider: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat', api_key: 'sk-from-dsh' } })
  assert.equal(await started(s), true)
  assert.equal(dump().env.HINDSIGHT_API_LLM_API_KEY, 'sk-from-dsh')
  assert.ok(!readFileSync(p, 'utf8').includes('sk-from-dsh'))
  await s.stop()
})

await ok('preflight: missing embedding/LLM key blocks the start with Chinese hints (no spawn)', async () => {
  const fresh = mkdtempSync(join(tmpdir(), 'hs-pre-'))
  process.env.DSH_HINDSIGHT_PLUGIN_ROOT = fresh
  process.env.DSH_HINDSIGHT_ENV_BACKUP = join(fresh, 'no-backup', 'plugin.env') // a brand-new install, nothing to restore
  writeFileSync(DUMP, '{}')
  const s = service({ ...PANEL, embedding: { provider: '' }, llm: { mode: 'custom', provider: 'deepseek', api_key: '' } })
  assert.equal(await s.ensureReady('test'), false)
  assert.deepEqual(JSON.parse(readFileSync(DUMP, 'utf8')), {}, 'server must not be spawned')
  assert.match(s.lastError, /未启动本地 Hindsight.*Embedding/)
  const st = await s.deployStatus()
  assert.equal(st.steps[0].status, 'failed')
  assert.match(st.hint, /LLM.*API Key/)
  const r = preflightEnv({ HINDSIGHT_API_EMBEDDINGS_PROVIDER: 'openai', HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY: 'k', HINDSIGHT_API_RERANKER_PROVIDER: 'none', HINDSIGHT_API_LLM_PROVIDER: 'none' })
  assert.ok(r.errors.some((e) => /rrf/.test(e)))
  await s.stop()
  process.env.DSH_HINDSIGHT_PLUGIN_ROOT = pluginRoot
})

await ok('child exits early: stdout/stderr captured, last lines logged + hint, no full timeout wait', async () => {
  process.env.FAKE_MODE = 'crash'
  const s = service({ ...PANEL, service: { ...PANEL.service, startup_timeout_ms: 20000 } }, { plan: [health.bad] })
  const t0 = Date.now()
  assert.equal(await s.ensureReady('test'), false)
  assert.ok(Date.now() - t0 < 8000, 'should fail fast after the child exits')
  delete process.env.FAKE_MODE
  const st = await s.deployStatus()
  assert.ok(st.tail.some((l) => l.includes('sentence-transformers')), st.tail.join('\n'))
  assert.match(st.hint, /Embedding/)
  assert.match(s.lastError, /进程已退出 \(code=3\)/)
  const w = logs.find(([lvl, m]) => lvl === 'warn' && m.includes('Hindsight child exited (code=3'))
  assert.ok(w && w[1].includes('| ImportError: sentence-transformers'), w?.[1])
  assert.ok(existsSync(join(process.env.DSH_HINDSIGHT_LOG_DIR, 'hindsight.log')))
  await s.stop()
})

await ok('setup=unset + mode auto: never starts, logs once, no retry storm', async () => {
  logs.length = 0
  const s = service({ setup: 'unset' }, { plan: [health.bad] })
  for (let i = 0; i < 3; i++) await s.ensureReady('test')
  assert.equal(s.launchMode === 'process', false)
  assert.match(s.lastError, /尚未完成首次设置/)
  assert.ok(!logs.some(([, m]) => /attach only/.test(m)))
  assert.equal(logs.filter(([lvl, m]) => lvl === 'warn' && /not set up yet/.test(m)).length, 1)
  s.lastAttemptAt = 0
  s.maybeRetry('x')
  assert.equal(s.retryDelay, 0, 'unset: no retries at all')
  await s.stop()
})

await ok('retry backoff doubles up to 10 min; repeated errors logged once', async () => {
  logs.length = 0
  const s = service({ setup: 'existing', service: { retry_degraded_ms: 30000 } }, { plan: [health.bad] })
  await s.ensureReady('t')
  const delays = []
  for (let i = 0; i < 7; i++) { s.lastAttemptAt = 0; s.maybeRetry('t'); delays.push(s.retryDelay); if (s.pending) await s.pending }
  // An existing server is probed at most once a minute so a restarted server is picked up quickly.
  assert.deepEqual(delays, [60000, 60000, 60000, 60000, 60000, 60000, 60000])
  assert.equal(logs.filter(([lvl, m]) => lvl === 'warn' && /not reachable/.test(m)).length, 1)
  await s.stop()
  const l = service({ setup: 'manual', service: { mode: 'attach', retry_degraded_ms: 30000 } }, { plan: [health.bad] })
  await l.ensureReady('t')
  const d2 = []
  for (let i = 0; i < 7; i++) { l.lastAttemptAt = 0; l.maybeRetry('t'); d2.push(l.retryDelay); if (l.pending) await l.pending }
  assert.deepEqual(d2, [60000, 120000, 240000, 480000, 600000, 600000, 600000])
  await l.stop()
})

await ok('defaults: SiliconFlow bge-m3 / bge-reranker-v2-m3 / Xing4.0-29B; one key shared by host', () => {
  const c = resolveConfig({ embedding: { api_key: 'sk-sf' } }, { env: {} }).config
  assert.equal(c.embedding.provider, 'openai'); assert.equal(c.embedding.base_url, 'https://api.siliconflow.cn/v1'); assert.equal(c.embedding.model, 'BAAI/bge-m3')
  assert.equal(c.reranker.provider, 'siliconflow'); assert.equal(c.reranker.model, 'BAAI/bge-reranker-v2-m3'); assert.equal(c.reranker.api_key, 'sk-sf')
  assert.equal(c.llm.mode, 'follow'); assert.equal(c.llm.model, 'XingChenAGI/Xing4.0-29B'); assert.equal(c.llm.api_key, 'sk-sf')
  const c2 = resolveConfig({ embedding: { api_key: 'a' }, llm: { base_url: 'https://api.deepseek.com' } }, { env: {} }).config
  assert.equal(c2.llm.api_key, '')
})

await ok('explainFailure covers the common Windows failures', () => {
  assert.match(explainFailure('ValueError: LLM API key is required'), /LLM/)
  assert.match(explainFailure('OSError: [WinError 10048] address'), /端口/)
  assert.match(explainFailure('ERROR: Could not find a version that satisfies'), /镜像/)
  assert.match(explainFailure("'py' is not recognized as an internal or external command"), /Python 3.12/)
  assert.match(summarizeEnv({ HINDSIGHT_API_LLM_PROVIDER: 'none' }), /embeddings=\[\(default=local!\)/)
})

console.log(`${passed} pass`)
