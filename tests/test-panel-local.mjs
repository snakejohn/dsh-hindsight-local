/**
 * Unit tests: settings-panel schema, setup wizard mapping, local (slim + pg0) launch plan,
 * and the hand-written web client bundle shape.
 * Run: node tests/test-panel-local.mjs   (schema tests skip when no dsh install is resolvable)
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../lib/config.js'
import { planLocal, localEnv, localVariant, localProblems, pythonCandidates, venvPaths } from '../lib/local.js'
import { buildConfigSchema, loadSchemastery, plainConfig } from '../lib/schema.js'
// Point at a dsh checkout's built schemastery when one is around (DSH_REPO, default ../dsh).
const repo = process.env.DSH_REPO || fileURLToPath(new URL('../../dsh', import.meta.url))
const built = `${repo}/vendor/schemastery/lib/index.mjs`
if (!process.env.DSH_HINDSIGHT_SCHEMASTERY && existsSync(built)) process.env.DSH_HINDSIGHT_SCHEMASTERY = built
const { default: apply, Config } = await import('../index.js')

let passed = 0
async function ok(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }
const cfg = (inline) => resolveConfig(inline, { env: {} }).config
const probe = (cmds, py = null, platform = 'linux') => ({ platform, has: async (c) => cmds.includes(c), python: async () => py })

await ok('setup=existing forces attach, no autostart', () => {
  const c = cfg({ setup: 'existing', service: { mode: 'docker', autostart: true, base_url: 'http://h:1/' } })
  assert.equal(c.service.mode, 'attach'); assert.equal(c.service.autostart, false); assert.equal(c.service.base_url, 'http://h:1')
})
await ok('setup=local forces local mode on 127.0.0.1:<port>', () => {
  const c = cfg({ setup: 'local', service: { local: { port: 18777 } } })
  assert.equal(c.service.mode, 'local'); assert.equal(c.service.autostart, true); assert.equal(c.service.base_url, 'http://127.0.0.1:18777')
})
await ok('setup unknown -> unset with warning; default is unset', () => {
  assert.equal(cfg({}).setup, 'unset')
  const r = resolveConfig({ setup: 'x' }, { env: {} }); assert.equal(r.config.setup, 'unset'); assert.ok(r.warnings.length)
})
await ok('variant: slim with remote embedding, full with local models', () => {
  assert.equal(localVariant(cfg({ embedding: { provider: 'openai' } })), 'slim')
  assert.equal(localVariant(cfg({ embedding: { provider: '' } })), 'slim') // unset embedding: preflight blocks instead of a 2 GB full install
  assert.equal(localVariant(cfg({ embedding: { provider: 'local' } })), 'full')
  assert.equal(localVariant(cfg({ embedding: { provider: 'openai' }, reranker: { provider: 'flashrank' } })), 'full')
  assert.equal(localVariant(cfg({ embedding: { provider: '' }, service: { local: { variant: 'slim' } } })), 'slim')
})
await ok('local env: pg0, rrf reranker and llm none when empty on slim', () => {
  const e = localEnv(cfg({ embedding: { provider: 'openai', api_key: 'k' }, reranker: { provider: '' }, llm: { mode: 'none' } }))
  assert.equal(e.HINDSIGHT_API_DATABASE_URL, 'pg0://dsh-hindsight')
  assert.equal(e.HINDSIGHT_API_RERANKER_PROVIDER, 'rrf'); assert.equal(e.HINDSIGHT_API_LLM_PROVIDER, 'none')
  const e2 = localEnv(cfg({ embedding: { provider: 'openai' }, reranker: { provider: 'cohere' }, llm: { provider: 'deepseek', api_key: 'k' }, service: { local: { hf_endpoint: 'https://hf-mirror.com' } } }))
  assert.equal(e2.HINDSIGHT_API_RERANKER_PROVIDER, undefined); assert.equal(e2.HINDSIGHT_API_LLM_PROVIDER, undefined); assert.equal(e2.HF_ENDPOINT, 'https://hf-mirror.com')
})
await ok('local problems: slim without embedding, missing key', () => {
  assert.ok(localProblems(cfg({ embedding: { provider: '' }, service: { local: { variant: 'slim' } } })).some((p) => /embedding/.test(p)))
  assert.ok(localProblems(cfg({ embedding: { provider: 'openai' } })).some((p) => /api_key/.test(p)))
  assert.deepEqual(localProblems(cfg({ embedding: { provider: 'openai', api_key: 'k' } })), [])
})
await ok('windows python candidates and venv layout', () => {
  assert.deepEqual(pythonCandidates('win32')[0], ['py', '-3.12'].length ? pythonCandidates('win32')[0] : null)
  const p = venvPaths('C:\\v', 'win32'); assert.match(p.server, /Scripts.hindsight-api\.exe$/); assert.match(p.python, /Scripts.python\.exe$/)
  assert.match(venvPaths('/v', 'linux').server, /bin\/hindsight-api$/)
})
await ok('plan: venv first with slim[embedded-db] pinned, 127.0.0.1:8888', async () => {
  const c = cfg({ setup: 'local', embedding: { provider: 'openai', api_key: 'k' } })
  const p = await planLocal(c, probe(['uvx', 'docker'], 'python3.12', 'win32'))
  assert.equal(p.kind, 'venv'); assert.equal(p.basePython, 'python3.12')
  assert.equal(p.pkg, 'hindsight-api-slim[embedded-db]==1.1.0')
  assert.deepEqual(p.args, ['--host', '127.0.0.1', '--port', '8888'])
  assert.notEqual(p.python, p.basePython)
})
await ok('plan: falls back uvx -> pip -> docker -> none', async () => {
  const c = cfg({ setup: 'local', embedding: { provider: 'openai', api_key: 'k' } })
  const u = await planLocal(c, probe(['uvx', 'docker'])); assert.equal(u.runner, 'uvx'); assert.ok(u.args.includes('hindsight-api-slim[embedded-db]==1.1.0'))
  assert.equal((await planLocal(c, probe(['hindsight-api', 'docker']))).runner, 'pip')
  const d = await planLocal(c, probe(['docker'])); assert.equal(d.kind, 'docker'); assert.equal(d.image, 'ghcr.io/vectorize-io/hindsight:1.1.0-slim')
  const n = await planLocal(c, probe([], null, 'win32')); assert.equal(n.kind, 'none'); assert.match(n.reason, /winget|pip install/)
})
await ok('plan: explicit runner honoured', async () => {
  const c = cfg({ setup: 'local', embedding: { provider: 'openai', api_key: 'k' }, service: { local: { runner: 'docker' } } })
  assert.equal((await planLocal(c, probe(['uvx', 'docker'], 'python3'))).kind, 'docker')
})

const z = await loadSchemastery().catch(() => null)
if (!z) console.log('SKIP schema tests (no dsh schemastery resolvable from this process)')
else {
  await ok('schema: volatile root, secrets, unions, keeps unknown keys, no defaults', () => {
    const s = buildConfigSchema(z)
    assert.equal(s.meta.volatile, true); assert.ok(s.toJSON().refs)
    assert.equal(s.dict.service.dict.api_key.meta.role, 'secret')
    const out = plainConfig(s({ setup: 'local', extra: { a: 1 }, bank: { workspace_bank_mapping: { '/a': 'b', '/c': 'b' } } }))
    assert.equal(out.setup, 'local'); assert.deepEqual(out.extra, { a: 1 }); assert.equal(out.bank.workspace_bank_mapping['/c'], 'b')
    assert.equal(plainConfig(s({})).recall?.top_n, undefined) // no defaults: the JSON file / patch stay authoritative
    assert.throws(() => s({ setup: 'bogus' }))
  })
  await ok('index exports Config on the default runtime too', () => {
    assert.ok(Config); assert.equal(apply.Config, Config); assert.equal(apply.name, 'dsh-hindsight-memory')
  })
}

await ok('web client bundle registers through __ModuleLoader__ with platform modules only', () => {
  const src = readFileSync(fileURLToPath(new URL('../web/client.js', import.meta.url)), 'utf8')
  let loaded
  const window = { __ModuleLoader__: { load: (m) => { loaded = m } } }
  new Function('window', src)(window)
  assert.equal(loaded.id, 'dsh-hindsight-memory')
  const asked = []
  const fakeReact = { createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => ({}), useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f }
  const mod = loaded.factory((name) => { asked.push(name); return fakeReact })
  assert.ok(asked.every((n) => ['react', 'react/jsx-runtime', 'react-dom'].includes(n)), asked.join(','))
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('configForms'))
  const slots = []; const ctx = { slots: { inject: (n, cb) => { slots.push([n]); cb() }, register: (...a) => { slots.push(a) ; return () => {} } }, locale: { extend: () => {}, register: () => {}, t: (k) => k }, configForms: { get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {} }) }, effect: (f) => f(), on: () => {} }
  mod.apply(ctx)
  const names = JSON.stringify(slots)
  assert.match(names, /plugins\.bundle\.config/); assert.match(names, /plugins\.bundle\.activation/)
})

console.log(`\n${passed} passed`)
