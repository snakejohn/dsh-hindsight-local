/**
 * Issue #4: a Python whose ctypes/ssl/sqlite3 cannot load ("DLL load failed while importing
 * _ctypes", exit 3221225477) must not be used for the venv, and an existing venv built from it
 * must be rebuilt. Fake interpreters on PATH (node scripts) stand in for real ones.
 * Run: node tests/test-broken-python.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hs-brokenpy-'))
const home = join(root, 'home')
const bin = join(root, 'bin')
mkdirSync(join(root, 'plugin'), { recursive: true }); mkdirSync(bin); mkdirSync(home)
process.env.HOME = process.env.USERPROFILE = home
process.env.DSH_HINDSIGHT_PLUGIN_ROOT = join(root, 'plugin')
process.env.DSH_HINDSIGHT_LOG_DIR = join(root, 'logs')
const SERVER = `#!/usr/bin/env node
setInterval(() => {}, 1000)
`
const BROKEN = `#!/usr/bin/env node
console.error('Traceback (most recent call last):\\n  File "<string>", line 1, in <module>\\n  File "D:\\\\22\\\\python\\\\Lib\\\\ctypes\\\\__init__.py", line 8, in <module>\\nImportError: DLL load failed while importing _ctypes: 找不到指定的程序。')
process.exit(1)
`
// Healthy venv interpreter: passes the probe, "pip install" drops a fake hindsight-api next to it.
const VENV_PY = `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const a = process.argv.slice(2)
if (a[0] === '-m' && a[1] === 'pip') { const s = path.join(__dirname, 'hindsight-api'); fs.writeFileSync(s, ${JSON.stringify(SERVER)}); fs.chmodSync(s, 0o755); process.exit(0) }
process.exit(0)
`
// Healthy base interpreter: version probe prints 1, "-m venv DIR" makes a fake venv.
const BASE_PY = `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const a = process.argv.slice(2)
if (a[0] === '-c') { console.log(a[1].includes('version_info') ? '1' : ''); process.exit(0) }
if (a[0] === '-m' && a[1] === 'venv') {
  const d = a[2]; fs.mkdirSync(path.join(d, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(d, 'pyvenv.cfg'), 'home = ' + __dirname + '\\n')
  fs.writeFileSync(path.join(d, 'bin', 'python'), ${JSON.stringify(VENV_PY)}); fs.chmodSync(path.join(d, 'bin', 'python'), 0o755)
  process.exit(0)
}
process.exit(2)
`
const put = (f, s) => { writeFileSync(f, s); chmodSync(f, 0o755) }
put(join(bin, 'python3.12'), BROKEN) // first candidate: broken like D:\22\python
put(join(bin, 'python3.13'), BASE_PY)
process.env.PATH = `${bin}:${process.env.PATH}`

const { HindsightService, pythonProbeProblem, discardVenv, PY_PROBE } = await import('../lib/lifecycle.js')
const { resolveConfig } = await import('../lib/config.js')
const { explainFailure } = await import('../lib/deploy.js')
const { PRESETS } = await import('../lib/presets.js')
const { exportLogs } = await import('../lib/logfiles.js')
const { dshVersion } = await import('../lib/rpc.js')

let passed = 0
async function ok(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }
const logs = []
const logger = { debug: (m) => logs.push(['debug', m]), info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) }
const PANEL = {
  setup: 'local',
  service: { local: { runner: 'venv', port: 18557, auto_bootstrap: false, dim_probe: false }, startup_timeout_ms: 4000, health_interval_ms: 100, health_timeout_ms: 200, shutdown_grace_ms: 300 },
  embedding: { provider: 'openai', base_url: 'https://api.siliconflow.cn/v1', api_key: 'sk-emb-test', model: 'BAAI/bge-m3' },
  reranker: { provider: '' },
  llm: { mode: 'custom', provider: 'deepseek', base_url: 'https://api.deepseek.com', api_key: 'sk-llm-test', model: 'deepseek-flash' }
}
function service() {
  const config = resolveConfig(JSON.parse(JSON.stringify(PANEL)), { env: {} }).config
  let i = 0
  const plan = [{ ok: false, status: 0, error: 'ECONNREFUSED' }, { ok: true, status: 200 }]
  const client = { async health() { return plan[Math.min(i++, plan.length - 1)] }, async version() { return { api_version: '1.1.0' } }, async ensureBank(id) { return { bankId: id } } }
  return new HindsightService({ config, logger, client })
}
const venv = join(home, '.dsh-hindsight', 'venv')

await ok('probe checks ctypes/ssl/sqlite3 + version; failure reasons are short and readable', () => {
  assert.match(PY_PROBE, /import sys, ctypes, ssl, sqlite3/)
  assert.equal(pythonProbeProblem({ ok: false, code: 'ENOENT', stderr: 'spawn python3.11 ENOENT' }), '')
  assert.equal(pythonProbeProblem({ ok: true, stdout: '0\n' }), 'version < 3.11')
  assert.match(pythonProbeProblem({ ok: false, code: 1, stderr: 'Traceback\n  File x\nImportError: DLL load failed while importing _ctypes: 找不到指定的程序。\n' }), /^ImportError: DLL load failed while importing _ctypes/)
  assert.match(pythonProbeProblem({ ok: false, code: 3221225477, stderr: '' }), /0xC0000005/)
})

await ok('deploy hint: DLL load failed / 0xC0000005 / 3221225477 -> Python 安装已损坏', () => {
  for (const t of ['ImportError: DLL load failed while importing _ctypes: 找不到指定的程序。', 'DLL load failed while importing _ssl', 'DLL load failed while importing _sqlite3', 'exit code=3221225477', 'Exception 0xC0000005']) {
    assert.match(explainFailure(t), /Python 安装已损坏/, t)
    assert.match(explainFailure(t), /重新部署/)
  }
  assert.doesNotMatch(explainFailure('DLL load failed while importing numpy'), /Python 安装已损坏/)
})

await ok('broken first candidate is skipped (logged with reason); venv is built from the next healthy Python', async () => {
  const s = service()
  assert.equal(await s.ensureReady('test'), true, JSON.stringify(s.deploy))
  const skip = logs.find(([, m]) => /skipping Python candidate "python3\.12": ImportError: DLL load failed while importing _ctypes/.test(m))
  assert.ok(skip, logs.map((l) => l[1]).join('\n'))
  assert.deepEqual(s.localPlan.basePython, ['python3.13'])
  assert.ok(readFileSync(join(venv, 'pyvenv.cfg'), 'utf8').includes(bin))
  assert.ok(existsSync(join(venv, 'bin', 'hindsight-api')))
  await s.stop()
})

await ok('existing venv whose Python cannot import ctypes is removed and rebuilt; memory data untouched', async () => {
  // Simulate the issue: a venv made earlier from the broken Python, fully "installed".
  put(join(venv, 'bin', 'python'), BROKEN)
  const marker = readFileSync(join(venv, 'dsh-installed.txt'), 'utf8')
  assert.ok(marker.trim())
  const pg = join(home, '.pg0', 'instances', 'dsh-hindsight')
  mkdirSync(pg, { recursive: true }); writeFileSync(join(pg, 'PG_VERSION'), '16\n')
  logs.length = 0
  const s = service()
  assert.equal(await s.ensureReady('test'), true, JSON.stringify(s.deploy))
  const warn = logs.find(([lvl, m]) => lvl === 'warn' && /依赖环境 .*venv 里的 Python 已损坏（ImportError: DLL load failed/.test(m))
  assert.ok(warn, logs.map((l) => l[1]).join('\n'))
  assert.ok(logs.some(([, m]) => /removed broken venv/.test(m)))
  // rebuilt with the healthy fake venv interpreter
  assert.doesNotMatch(readFileSync(join(venv, 'bin', 'python'), 'utf8'), /DLL load failed/)
  assert.equal(readFileSync(join(pg, 'PG_VERSION'), 'utf8'), '16\n')
  await s.stop()
})

await ok('healthy venv is reused as is (no rebuild, no warning)', async () => {
  logs.length = 0
  const s = service()
  assert.equal(await s.ensureReady('test'), true)
  assert.ok(!logs.some(([, m]) => /已损坏|creating venv|removed broken venv/.test(m)), logs.map((l) => l[1]).join('\n'))
  await s.stop()
})

await ok('only broken Pythons and no bootstrap: plan fails with the normal "no Python" message', async () => {
  put(join(bin, 'python3.13'), BROKEN)
  for (const n of ['python3.11', 'python3']) put(join(bin, n), BROKEN)
  logs.length = 0
  const s = service()
  const r = await s.start()
  assert.equal(r.ok, false)
  assert.match(s.deploy.error || r.error || '', /no Python >= 3\.11/)
  assert.equal(logs.filter(([, m]) => /skipping Python candidate/.test(m)).length, 4)
  put(join(bin, 'python3.13'), BASE_PY)
})

await ok('self-downloaded Python lookup is managed-only (never a broken PATH Python)', async () => {
  const { uvPythonEnv } = await import('../lib/bootstrap.js')
  assert.equal(uvPythonEnv('', '/r').UV_PYTHON_PREFERENCE, 'only-managed')
})

await ok('discardVenv refuses a directory that is not a venv', () => {
  const d = join(root, 'notvenv'); mkdirSync(d); writeFileSync(join(d, 'keep.txt'), 'x')
  assert.equal(discardVenv(d).ok, false)
  assert.ok(existsSync(join(d, 'keep.txt')))
})

await ok('DeepSeek: preset uses deepseek-flash; retired deepseek-chat migrated (custom only, not follow)', () => {
  assert.equal(PRESETS.llm.deepseek.model, 'deepseek-flash')
  const r = resolveConfig({ llm: { mode: 'custom', provider: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat', api_key: 'k' } }, { env: {} })
  assert.equal(r.config.llm.model, 'deepseek-flash')
  assert.ok(r.warnings.some((w) => /deepseek-chat.*deepseek-flash/.test(w)))
  const viaUrl = resolveConfig({ llm: { mode: 'custom', provider: 'openai', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', api_key: 'k' } }, { env: {} })
  assert.equal(viaUrl.config.llm.model, 'deepseek-flash')
  const other = resolveConfig({ llm: { mode: 'custom', provider: 'openai', base_url: 'https://relay.example/v1', model: 'deepseek-chat', api_key: 'k' } }, { env: {} })
  assert.equal(other.config.llm.model, 'deepseek-chat') // third-party relay may still serve that name
  const follow = resolveConfig({ llm: { mode: 'follow', provider: 'deepseek', model: 'deepseek-chat' } }, { env: {} })
  assert.equal(follow.config.llm.model, 'deepseek-chat')
})

await ok('log export header has the dsh version', () => {
  const pkgDir = join(root, 'nm', '@deepseek-ai', 'dsh'); mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.4' }))
  assert.equal(dshVersion({ argv1: join(pkgDir, 'lib', 'bin.js'), env: {} }), '0.2.1-rc.4')
  assert.equal(dshVersion({ argv1: join(root, 'x', 'y.js'), env: {} }), '')
  const f = exportLogs({ dir: join(root, 'logs'), outDir: join(root, 'exp'), version: '0.1.7', dshVersion: '0.2.1-rc.4' })
  assert.match(readFileSync(f, 'utf8'), /dsh 版本: 0\.2\.1-rc\.4/)
  const g = exportLogs({ dir: join(root, 'logs'), outDir: join(root, 'exp2'), version: '0.1.7' })
  assert.match(readFileSync(g, 'utf8'), /dsh 版本: 未知/)
})

console.log(`\n${passed} passed`)
