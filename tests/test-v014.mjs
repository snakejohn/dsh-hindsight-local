/**
 * v0.1.4: banner/cover carry the package.json version; 「记住哪些内容」 mirrored into .env.
 * Run: node tests/test-v014.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = mkdtempSync(join(tmpdir(), 'hs-v014-'))
process.env.DSH_HINDSIGHT_PLUGIN_ROOT = dir
const { resolveConfig, retainEnv, RETAIN_ENV_KEYS } = await import('../lib/config.js')
const { syncDotenv, readDotenv } = await import('../lib/dotenv.js')

let pass = 0
const test = async (name, fn) => { await fn(); pass++; console.log('ok -', name) }

function pngInfo(file) {
  const b = readFileSync(file)
  const out = { w: b.readUInt32BE(16), h: b.readUInt32BE(20), text: {} }
  for (let i = 8; i < b.length;) {
    const len = b.readUInt32BE(i); const type = b.toString('latin1', i + 4, i + 8); const data = b.subarray(i + 8, i + 8 + len)
    if (type === 'tEXt') { const z = data.indexOf(0); out.text[data.toString('latin1', 0, z)] = data.toString('latin1', z + 1) }
    if (type === 'zTXt' || type === 'iTXt') { const z = data.indexOf(0); if (type === 'zTXt') out.text[data.toString('latin1', 0, z)] = inflateSync(data.subarray(z + 2)).toString() }
    i += 12 + len
  }
  return out
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

await test('banner/cover show the package.json version (run npm run release:assets after a bump)', () => {
  for (const [f, w, h] of [['banner.png', 1280, 640], ['cover.png', 1920, 1080]]) {
    const p = pngInfo(join(root, 'docs/images', f))
    assert.equal(p.w, w); assert.equal(p.h, h)
    assert.equal(p.text['dsh-hindsight-version'], version, `${f} is stale: npm run release:assets`)
  }
})

await test('docs pin jsDelivr URLs to the current tag', () => {
  for (const f of ['README.md', 'docs/使用文档.md', 'docs/小黑盒文章.md']) {
    const t = readFileSync(join(root, f), 'utf8')
    const tags = [...t.matchAll(/cdn\.jsdelivr\.net\/gh\/[^@\s]+@([^/\s)]+)/g)].map((m) => m[1])
    for (const tag of tags) assert.equal(tag, 'v' + version, `${f} still links @${tag}`)
  }
})

await test('retainEnv: defaults and panel values become DSH_HINDSIGHT_RETAIN_* lines', () => {
  const d = retainEnv(resolveConfig({}, { env: {} }).config)
  assert.deepEqual(Object.keys(d).sort(), [...RETAIN_ENV_KEYS].sort())
  assert.equal(d.DSH_HINDSIGHT_RETAIN_USER, 'true'); assert.equal(d.DSH_HINDSIGHT_RETAIN_TOOL_CALLS, 'false')
  assert.equal(d.DSH_HINDSIGHT_RETAIN_MIN_CHARS, '24')
  const c = retainEnv(resolveConfig({ retain: { include_reasoning: true, min_turn_chars: 40, include_user: false } }, { env: {} }).config)
  assert.equal(c.DSH_HINDSIGHT_RETAIN_REASONING, 'true'); assert.equal(c.DSH_HINDSIGHT_RETAIN_MIN_CHARS, '40'); assert.equal(c.DSH_HINDSIGHT_RETAIN_USER, 'false')
})

await test('syncDotenv writes retain lines, keeps service keys, and false overwrites true', () => {
  const path = join(dir, '.env')
  syncDotenv({ HINDSIGHT_API_PORT: '8888' }, { path })
  syncDotenv(retainEnv(resolveConfig({ retain: { include_tool_calls: true } }, { env: {} }).config), { path })
  let e = readDotenv(path)
  assert.equal(e.HINDSIGHT_API_PORT, '8888'); assert.equal(e.DSH_HINDSIGHT_RETAIN_TOOL_CALLS, 'true')
  syncDotenv(retainEnv(resolveConfig({ retain: { include_tool_calls: false } }, { env: {} }).config), { path })
  e = readDotenv(path)
  assert.equal(e.DSH_HINDSIGHT_RETAIN_TOOL_CALLS, 'false'); assert.equal(e.HINDSIGHT_API_PORT, '8888')
  assert.match(readFileSync(path, 'utf8'), /记住哪些内容/)
})

await test('sidebar 记住于: a failed extraction never counts, a later success does', async () => {
  const { buildRuntime, createFakeClient, buildSession, createFakeAgent } = await import('./harness.mjs')
  const { sidebarStatus } = await import('../lib/rpc.js')
  const sd = mkdtempSync(join(tmpdir(), 'hs-v014-sb-'))
  const client = createFakeClient(); const ops = new Map()
  client.retain = async () => { ops.set('op1', 'failed'); return { operation_id: 'op1' } }
  client.operation = async (b, id) => ({ status: ops.get(id), error_message: '429 Too Many Requests' })
  const { runtime, config } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: sd } } })
  await runtime.retainAgent(createFakeAgent({ session: buildSession({ id: 'f1', turns: [{ user: '我今天早上七点去公园跑了五公里，感觉很好', assistant: '真棒，坚持下去！' }] }) }))
  await runtime.ops.poll()
  let v = await sidebarStatus({ runtime, config: { ...config, enabled: true } })
  assert.equal(v.lastRetain, '', 'failed op is not 记住')
  client.retryOperation = async () => { ops.set('op1', 'completed'); return {} }
  await runtime.ops.retryAll(); await runtime.ops.poll()
  v = await sidebarStatus({ runtime, config: { ...config, enabled: true } })
  assert.ok(v.lastRetain, 'set after the retry really finished')
})

console.log(`\n${pass} passed`)
