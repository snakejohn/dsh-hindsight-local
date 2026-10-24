// API keys live only in the plugin .env, never in dsh's cordis.patch.yml.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hs-keys-'))
process.env.DSH_HINDSIGHT_PLUGIN_ROOT = root
const { writeDotenvKeys, inlineKeys, dotenvKeyEnv, readDotenv, KEY_VARS } = await import('../lib/dotenv.js')
const { keyStates, clearDotenvKeys } = await import('../lib/keystate.js')
const { resolveConfig } = await import('../lib/config.js')
const { createRpcHandler } = await import('../lib/rpc.js')

let pass = 0
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name) }
const envPath = join(root, '.env')
const A = 'test-key-embedding-0001', B = 'test-key-llm-0002', C = 'test-key-other-0003'

await t('inlineKeys picks the four key paths only', () => {
  assert.deepEqual(inlineKeys({ embedding: { api_key: ` ${A} `, provider: 'x' }, llm: { api_key: '' }, service: { api_key: B } }),
    { 'embedding.api_key': A, 'service.api_key': B })
  assert.deepEqual(inlineKeys(undefined), {})
})

await t('writeDotenvKeys writes names (not values), skips empty/newline, keeps other lines', () => {
  writeFileSync(envPath, 'HINDSIGHT_API_PORT=1234\n')
  const r = writeDotenvKeys({ 'embedding.api_key': A, 'llm.api_key': '', 'reranker.api_key': 'a\nb', 'bogus.api_key': C })
  assert.equal(r.error, ''); assert.deepEqual(r.written, ['DSH_HINDSIGHT_EMBEDDING_API_KEY'])
  const env = readDotenv(envPath)
  assert.equal(env.DSH_HINDSIGHT_EMBEDDING_API_KEY, A); assert.equal(env.HINDSIGHT_API_PORT, '1234')
  assert.ok(!('DSH_HINDSIGHT_RERANKER_API_KEY' in env))
})

await t('overwrite=false keeps an existing key (startup migration), overwrite=true replaces', () => {
  assert.deepEqual(writeDotenvKeys({ 'embedding.api_key': C }, { overwrite: false }).written, [])
  assert.equal(readDotenv(envPath).DSH_HINDSIGHT_EMBEDDING_API_KEY, A)
  assert.deepEqual(writeDotenvKeys({ 'embedding.api_key': C }).written, ['DSH_HINDSIGHT_EMBEDDING_API_KEY'])
  assert.equal(readDotenv(envPath).DSH_HINDSIGHT_EMBEDDING_API_KEY, C)
  assert.deepEqual(writeDotenvKeys({ 'embedding.api_key': C }).written, [], 'unchanged value is not rewritten')
  writeDotenvKeys({ 'embedding.api_key': A, 'llm.api_key': B })
})

await t('dotenvKeyEnv feeds resolveConfig; .env beats inline, process env beats .env', () => {
  const env = dotenvKeyEnv()
  assert.deepEqual(Object.keys(env).sort(), ['DSH_HINDSIGHT_EMBEDDING_API_KEY', 'DSH_HINDSIGHT_LLM_API_KEY'])
  const cfg = resolveConfig({ embedding: { api_key: 'inline-old' } }, { env })
  assert.equal(cfg.config.embedding.api_key, A)
  const cfg2 = resolveConfig({}, { env: { ...env, DSH_HINDSIGHT_EMBEDDING_API_KEY: C } })
  assert.equal(cfg2.config.embedding.api_key, C)
})

await t('keyStates reports the dotenv source', () => {
  const s = keyStates({ dotenv: readDotenv(envPath), config: {} })
  assert.equal(s.embedding.set, true); assert.equal(s.embedding.source, 'dotenv')
  assert.equal(s.reranker.set, false)
})

await t('saveKeys RPC writes only to .env and reloads; no key echoed', async () => {
  let reloads = 0
  const raw = { embedding: { api_key: A } }
  const h = createRpcHandler({ ctx: {}, current: () => ({ rawConfig: raw, config: resolveConfig(raw, { env: dotenvKeyEnv() }).config }), reload: async () => { reloads++ } })
  const call = async (e, p) => { const res = await h(e, p); assert.equal(res.ok, true, JSON.stringify(res.error)); return res.value }
  const r = await call('saveKeys', { keys: { 'reranker.api_key': C } })
  assert.equal(r.ok, true); assert.deepEqual(r.written, ['DSH_HINDSIGHT_RERANKER_API_KEY']); assert.equal(reloads, 1)
  assert.ok(!JSON.stringify(r).includes(C), 'RPC reply never echoes the key')
  assert.equal(readDotenv(envPath).DSH_HINDSIGHT_RERANKER_API_KEY, C)
  await call('saveKeys', { keys: {} }); assert.equal(reloads, 1, 'nothing written -> no reload')
})

await t('clearDotenvKeys removes DSH_HINDSIGHT_*_API_KEY lines, keeps the rest', () => {
  const removed = clearDotenvKeys(envPath)
  for (const v of ['DSH_HINDSIGHT_EMBEDDING_API_KEY', 'DSH_HINDSIGHT_RERANKER_API_KEY', 'DSH_HINDSIGHT_LLM_API_KEY']) assert.ok(removed.includes(v), v)
  const env = readDotenv(envPath)
  assert.ok(!Object.keys(env).some((k) => /API_KEY$/.test(k))); assert.equal(env.HINDSIGHT_API_PORT, '1234')
  assert.ok(!readFileSync(envPath, 'utf8').includes(A))
})

await t('panel client routes api_key writes to saveKeys, not form.mutate', () => {
  const src = readFileSync(new URL('../web/client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('saveKeys')); assert.ok(src.includes('mutateKeys'))
  assert.equal(Object.keys(KEY_VARS).length, 4)
})

console.log(`${pass} pass`)
