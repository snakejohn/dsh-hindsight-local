// Settings panel v2: presets, model listing (mock /models), dsh workspace & default-model
// discovery via fake official services, RPC handler, archived-session exclusion, client render.
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { PRESETS, listingKind, fetchModels } from '../lib/presets.js'
import { listWorkspaces, resolveDshDefaultLlm, toHindsightLlm } from '../lib/host.js'
import { createRpcHandler } from '../lib/rpc.js'
import { backfillSessions } from '../lib/backfill.js'
import { buildRuntime, buildSession, createFakeClient } from './harness.mjs'

let passed = 0
const ok = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`) }

// Mock provider: OpenAI-compatible /v1/models and ollama /api/tags; records auth headers.
const seen = []
const srv = http.createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization || '' })
  res.setHeader('content-type', 'application/json')
  if (req.url === '/v1/models') {
    if (req.headers.authorization !== 'Bearer mock-key') { res.statusCode = 401; return res.end('{}') }
    return res.end(JSON.stringify({ data: [{ id: 'chat-x' }, { id: 'BAAI/bge-m3' }, { id: 'bge-reranker-v2-m3' }] }))
  }
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'nomic-embed-text' }] }))
  res.statusCode = 404; res.end('{}')
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`

await ok('presets carry real public base URLs and map to Hindsight providers', () => {
  assert.equal(PRESETS.embedding.siliconflow.base_url, 'https://api.siliconflow.cn/v1')
  assert.equal(PRESETS.embedding.siliconflow.provider, 'openai')
  assert.equal(PRESETS.reranker.cohere.provider, 'cohere')
  assert.equal(PRESETS.llm.deepseek.base_url, 'https://api.deepseek.com')
  for (const ch of Object.values(PRESETS)) for (const p of Object.values(ch)) assert.ok(p.base_url === '' || /^https?:\/\/[^ ]+$/.test(p.base_url), p.base_url)
  assert.equal(listingKind('llm', '', 'openai', 'http://localhost:11434/v1'), 'ollama')
})

await ok('fetchModels: OpenAI-compatible /models with Bearer, channel-ranked', async () => {
  const r = await fetchModels({ kind: 'openai', baseUrl: `${base}/v1`, apiKey: 'mock-key', channel: 'embedding' })
  assert.equal(r.models[0], 'BAAI/bge-m3')
  assert.equal(r.models.length, 3)
  const rr = await fetchModels({ kind: 'openai', baseUrl: `${base}/v1/`, apiKey: 'mock-key', channel: 'reranker' })
  assert.equal(rr.models[0], 'bge-reranker-v2-m3')
  await assert.rejects(fetchModels({ kind: 'openai', baseUrl: `${base}/v1`, apiKey: 'wrong', channel: 'llm' }), /401/)
  const o = await fetchModels({ kind: 'ollama', baseUrl: `${base}/v1`, channel: 'llm' })
  assert.deepEqual(o.models.sort(), ['nomic-embed-text', 'qwen2.5:7b'])
})

const archived = ['s-arch']
const registry = {
  get archivedSessionIds() { return archived },
  list: () => [
    { id: 'w1', path: '/home/me/rp/alice', title: 'alice', sessionIds: ['s1', 's2', 's-arch'] },
    { id: 'w2', path: '/home/me/rp/bob', title: 'bob', sessionIds: [] }
  ]
}

await ok('listWorkspaces counts conversations excluding archived ones', () => {
  const r = listWorkspaces({ get: (n) => (n === 'workspaceRegistry' ? registry : undefined) })
  assert.equal(r.available, true)
  assert.equal(r.workspaces[0].sessions, 2)
  assert.equal(r.workspaces[0].archived, 1)
  assert.deepEqual(r.workspaces[0].sessionIds, ['s1', 's2'])
  assert.equal(listWorkspaces({ get: () => undefined }).available, false)
})

const dshCtx = (keyValue) => ({
  get: (n) => ({
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) },
    llm: { listConfigurableProviders: () => [{ provider: 'deepseek', settingsNs: 'llm-deepseek', settingsPath: ['connection'], defaultBaseURL: 'https://api.deepseek.com/anthropic', nativeAuth: { env: ['DEEPSEEK_API_KEY'] } }] },
    settings: { describe: () => [{ ns: 'llm-deepseek', value: { connection: { apiKeyEnv: 'MY_DS_KEY' } } }] },
    credentials: { resolve: async (ref) => (ref === 'MY_DS_KEY' && keyValue ? { value: keyValue, source: 'env' } : undefined) }
  })[n]
})

await ok('resolveDshDefaultLlm follows dsh default model via official services', async () => {
  const r = await resolveDshDefaultLlm(dshCtx('mock-ds-key'), { env: {} })
  assert.equal(r.ok, true)
  assert.deepEqual(r.llm, { provider: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash', api_key: 'mock-ds-key' })
  assert.equal(r.keyRef, 'MY_DS_KEY')
  const miss = await resolveDshDefaultLlm(dshCtx(''), { env: {} })
  assert.equal(miss.ok, false)
  assert.match(miss.reason, /MY_DS_KEY/)
  assert.equal(miss.llm.model, 'deepseek-v4-flash', 'provider/base/model still suggested')
  assert.equal(toHindsightLlm({ provider: 'openai-compat', model: 'm', baseURL: 'http://x/v1/' }).provider, 'openai')
})

await ok('rpc: owner-only, models use saved key server-side, dshLlm never returns the key', async () => {
  const { runtime, config } = buildRuntime({ fakeClient: createFakeClient(), rawConfig: { llm: { api_key: 'mock-key' } } })
  const ctx = dshCtx('mock-ds-key')
  const handler = createRpcHandler({ ctx, current: () => ({ runtime, config }) })
  const owner = { principal: { kind: 'owner' } }
  const denied = await handler('overview', {}, undefined, { principal: { kind: 'guest' } })
  assert.equal(denied.ok, false)
  const m = await handler('models', { channel: 'llm', preset: 'openai', base_url: `${base}/v1`, api_key: '' }, undefined, owner)
  assert.equal(m.ok, true, JSON.stringify(m))
  assert.ok(m.value.models.includes('chat-x'))
  assert.equal(seen.at(-1).auth, 'Bearer mock-key', 'saved key used on the server')
  const d = await handler('dshLlm', {}, undefined, owner)
  assert.equal(d.value.llm.hasKey, true)
  assert.ok(!JSON.stringify(d).includes('mock-ds-key'))
  const o = await handler('overview', {}, undefined, owner)
  assert.equal(o.ok, true)
  assert.ok(!JSON.stringify(o).includes('mock-key'))
  assert.equal((await handler('nope', {}, undefined, owner)).ok, false)
})

await ok('archived sessions are excluded from backfill and manual retain jobs', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'hs-arch-'))
  const mk = (id, cwd) => { const s = buildSession({ id, turns: [{ user: `${id} 骑士出发去城堡`, assistant: '旁白：夜色中骑士骑马穿过森林，远处城堡灯火' }] }); s.header.cwd = cwd; return s }
  const stored = [mk('s1', '/home/me/rp/alice'), mk('s-arch', '/home/me/rp/alice'), mk('s3', '/home/me/rp/bob')]
  const persistence = {
    list: async () => stored.map((s) => ({ header: s.header })),
    open: async (id) => ({ read: async () => ({ events: stored.find((s) => s.header.id === id).log }), close: async () => {} })
  }
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: stateDir } } })
  runtime.workspaceRegistry = registry
  const sum = await backfillSessions({ runtime, persistence, config: runtime.config, logger: { info() {}, warn() {} }, filter: { workspaces: ['/home/me/rp/alice'] } })
  await runtime.flush()
  assert.equal(sum.archived, 1)
  assert.equal(sum.scanned, 1)
  const sent = client.calls.retain.flatMap((c) => c.items.map((i) => i.document_id))
  assert.ok(sent.every((d) => !d.startsWith('s-arch')), sent.join())
  assert.ok(sent.every((d) => !d.startsWith('s3')), 'workspace filter respected')
  // manual job via runtime.runJob reports progress and dedups on rerun
  runtime.persistence = persistence
  const before = client.calls.retain.flatMap((c) => c.items).length
  const r = await runtime.runJob('manual', {})
  assert.equal(r.started, true)
  await runtime.flush()
  for (let i = 0; i < 50 && runtime.job.running; i++) await new Promise((res) => setTimeout(res, 20))
  assert.equal(runtime.job.archived, 1)
  const after = client.calls.retain.flatMap((c) => c.items.map((i) => i.document_id)).slice(before)
  assert.ok(after.length > 0 && after.every((d) => d.startsWith('s3')), 'only s3 sent; s1 deduped by cursor: ' + after.join())
  assert.equal(runtime.job.total, 3)
})

await ok('web client renders (react-dom/server) settings + status with mocked rpc', async () => {
  const req = createRequire(process.env.DSH_REACT_FROM || '/workspace/dsh/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/package.json')
  let React, Server
  try { React = req('react'); Server = req('react-dom/server') } catch { console.log('  (react not resolvable, skipped)'); return }
  const src = readFileSync(fileURLToPath(new URL('../web/client.js', import.meta.url)), 'utf8')
  let loaded
  globalThis.document = { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } }
  new Function('window', src)({ __ModuleLoader__: { load: (m) => { loaded = m } } })
  const mod = loaded.factory(() => React)
  const form = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', value: { setup: 'local', llm: { mode: 'follow' }, bank: { workspace_bank_mapping: { '/x': 'b' } } } }), mutate: async () => true }
  const html = Server.renderToString(React.createElement(mod.Panel, { hsForm: form, hsApi: async () => ({}) }))
  assert.match(html, /hs26/)
  assert.match(html, /和 dsh 用同一个/)
  assert.match(html, /理解文字的模型/)
  assert.match(html, /现在就记住/)
  assert.match(html, /三步开始使用/); assert.match(html, /高级设置/); assert.match(html, /一键开始/)
})

srv.close()
console.log(`\n${passed} passed`)
