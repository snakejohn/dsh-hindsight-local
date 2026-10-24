// v0.1.2: per-field key state, proxy env cleaning (incl. fake Windows registry), model listing.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isRealKey, keyStates, dotenvVar, clearDotenvKeys } from '../lib/keystate.js'
import { cleanNoProxy, parseRegQuery, proxyEnv, readWindowsRegistry } from '../lib/proxy.js'
import { filterModels, fetchModels } from '../lib/presets.js'
import { explainFailure } from '../lib/deploy.js'
import { createRpcHandler } from '../lib/rpc.js'

const ok = (m) => console.log('PASS ' + m)
// --- keys
{
  for (const v of ['', '   ', 'undefined', 'null', 'sk-xxxx', 'sk-...', 'your_api_key', '<key>', '${KEY}', '***', 'sk-abc（已设置）', undefined, null, 0]) assert.equal(isRealKey(v), false, String(v))
  for (const v of ['sk-abcdef123456', ' sk-abc123 ']) assert.equal(isRealKey(v), true)
  ok('placeholders, whitespace and "undefined" are not keys')
  const sf = { embedding: { provider: 'openai', base_url: 'https://api.siliconflow.cn/v1' }, reranker: { provider: 'siliconflow', base_url: 'https://api.siliconflow.cn/v1' } }
  // fresh install: nothing anywhere; follow-dsh LLM resolved a dsh key into the runtime config
  let s = keyStates({ inline: {}, env: {}, dotenv: {}, config: { ...sf, llm: { mode: 'follow', api_key: 'sk-from-dsh-123' } } })
  assert.deepEqual([s.embedding.set, s.reranker.set, s.llm.set, s.llm.source], [false, false, false, 'dsh'])
  ok('fresh install: every field unset; follow-dsh LLM shows 使用 dsh 的密钥, not 已设置')
  // reranker inheriting the embedding key (same host) is not its own key
  s = keyStates({ inline: { embedding: { api_key: 'sk-emb-123456' } }, config: { ...sf, embedding: { ...sf.embedding, api_key: 'sk-emb-123456' }, reranker: { ...sf.reranker, api_key: 'sk-emb-123456' }, llm: { mode: 'custom' } } })
  assert.deepEqual([s.embedding.set, s.embedding.source, s.reranker.set, s.reranker.source, s.llm.set], [true, 'plugin-config', false, 'shared', false])
  ok('shared key counted only for its own field')
  // each source separately, never the value
  s = keyStates({ env: { DSH_HINDSIGHT_LLM_API_KEY: 'sk-envkey-1234' }, dotenv: { HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY: 'sk-dotenv-1234', HINDSIGHT_API_RERANKER_SILICONFLOW_API_KEY: 'undefined' }, config: { ...sf, llm: { mode: 'custom' } } })
  assert.deepEqual([s.embedding.source, s.reranker.set, s.llm.source], ['dotenv', false, 'env'])
  assert.ok(!JSON.stringify(s).includes('sk-'))
  assert.equal(dotenvVar('reranker', 'siliconflow'), 'HINDSIGHT_API_RERANKER_SILICONFLOW_API_KEY')
  ok('sources: .env / system env / plugin config, judged per field, values never returned')
  // .env.example is never read: only the given dotenv map counts
  const dir = mkdtempSync(join(tmpdir(), 'hs-keys-'))
  const f = join(dir, '.env')
  writeFileSync(f, 'HINDSIGHT_API_LLM_PROVIDER=openai\nHINDSIGHT_API_LLM_API_KEY=sk-aaa111\nHINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY="sk-bbb222"\nHINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL=BAAI/bge-m3\n')
  assert.deepEqual(clearDotenvKeys(f).sort(), ['HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY', 'HINDSIGHT_API_LLM_API_KEY'])
  const left = readFileSync(f, 'utf8')
  assert.ok(!/sk-/.test(left) && /LLM_PROVIDER=openai/.test(left) && /OPENAI_MODEL/.test(left))
  ok('清除密钥 removes only key lines from .env')
  // overview exposes keyState without values
  const runtime = { service: { ready: false, state: 'idle' }, stats: {}, job: null, recent: [], failures: [] }
  const config = { setup: 'local', service: { base_url: '', local: {} }, llm: { mode: 'follow', api_key: 'sk-dshdsh999' }, embedding: { provider: 'openai', api_key: '' }, reranker: {} }
  const rpc = createRpcHandler({ ctx: {}, current: () => ({ runtime, config, rawConfig: {} }) })
  const out = await rpc('overview', {})
  const ov = out?.value ?? out
  assert.equal(ov.keyState.llm.source, 'dsh'); assert.equal(ov.keysSet.llm, false); assert.equal(ov.keysSet.embedding, false)
  assert.ok(!JSON.stringify(ov).includes('sk-dshdsh999'))
  ok('overview: follow-dsh key is not reported as the plugin key and never leaks')
}
// --- proxy
{
  const { kept, dropped } = cleanNoProxy(['localhost', '::1', '[::1]', '<local>', '*.lan', '10.0.0.0/8', 'fe80::1%eth0', 'host:8080', '*', 'Example.COM', ''])
  assert.deepEqual(kept, ['localhost', '.lan', '10.0.0.0/8', 'example.com', '127.0.0.1'])
  assert.deepEqual(dropped, ['::1', '[::1]', '<local>', 'fe80::1%eth0', 'host:8080', '*'])
  ok('NO_PROXY: IPv6 literals, brackets, <local>, ports and wildcards dropped; localhost/127.0.0.1 ensured')
  const REG = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7897
    ProxyOverride    REG_SZ    localhost;127.*;10.*;192.168.*;<local>;::1;[::1]
`
  const reg = parseRegQuery(REG)
  assert.equal(reg.enabled, true)
  assert.deepEqual(reg.proxies, { http: 'http://127.0.0.1:7897', https: 'http://127.0.0.1:7897' })
  assert.ok(reg.bypass.includes('[::1]'))
  assert.deepEqual(parseRegQuery('    ProxyEnable    REG_DWORD    0x0\n    ProxyServer    REG_SZ    http=a:1;https=b:2').proxies, {})
  assert.deepEqual(parseRegQuery('    ProxyEnable    REG_DWORD    0x1\n    ProxyServer    REG_SZ    http=a:1;https=b:2;socks=c:3').proxies, { http: 'http://a:1', https: 'http://b:2' })
  assert.deepEqual(parseRegQuery(''), { enabled: false, proxies: {}, bypass: [] })
  ok('registry parsing (fake reg query output): enable flag, per-protocol servers, bypass list')
  assert.equal(readWindowsRegistry({ platform: 'win32', exec: () => { throw new Error('no reg') } }), null)
  assert.equal(readWindowsRegistry({ platform: 'win32', exec: () => REG }).enabled, true)
  assert.equal(readWindowsRegistry({ platform: 'linux' }), null)
  ok('registry read failure is skipped')
  // auto + registry proxy: explicit env so urllib never falls back to the registry
  let r = proxyEnv({ PATH: '/bin', no_proxy: 'localhost,::1', Some_Proxy: 'x' }, { registry: reg })
  assert.equal(r.env.HTTPS_PROXY, 'http://127.0.0.1:7897'); assert.equal(r.env.http_proxy, 'http://127.0.0.1:7897')
  assert.equal(r.env.NO_PROXY, 'localhost,127.0.0.1'); assert.equal(r.env.no_proxy, r.env.NO_PROXY)
  assert.ok(!('Some_Proxy' in r.env)); assert.equal(r.env.PATH, '/bin')
  ok('auto: system proxy passed explicitly, clean NO_PROXY')
  r = proxyEnv({ HTTPS_PROXY: 'http://u:p@proxy:3128', NO_PROXY: '[::1]' }, { registry: null })
  assert.equal(r.env.HTTP_PROXY, 'http://u:p@proxy:3128'); assert.ok(!r.summary.includes('u:p'))
  r = proxyEnv({ HTTPS_PROXY: 'http://proxy:3128' }, { mode: 'off', registry: reg })
  assert.equal(r.env.NO_PROXY, '*'); assert.ok(!('HTTPS_PROXY' in r.env))
  r = proxyEnv({}, { mode: 'custom', url: '127.0.0.1:7890', registry: reg })
  assert.equal(r.env.HTTPS_PROXY, 'http://127.0.0.1:7890')
  ok('modes: env proxy, 不用代理, 自定义地址')
  assert.match(explainFailure("httpx.InvalidURL: Invalid port: ':1]'"), /代理设置里有无法识别的地址/)
  ok('Invalid port in the start-up log -> Chinese hint')
}
// --- models
{
  assert.deepEqual(filterModels(['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3', 'deepseek-chat'], 'embedding'), ['BAAI/bge-m3'])
  assert.deepEqual(filterModels(['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3', 'deepseek-chat'], 'reranker'), ['BAAI/bge-reranker-v2-m3'])
  assert.deepEqual(filterModels(['x', 'y'], 'embedding'), ['x', 'y'])
  let seen = ''
  const res = await fetchModels({ kind: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'k', channel: 'reranker', fetchImpl: async (u) => { seen = u; return { ok: true, status: 200, json: async () => ({ data: [{ id: 'BAAI/bge-reranker-v2-m3' }] }) } } })
  assert.match(seen, /sub_type=reranker/); assert.deepEqual(res.models, ['BAAI/bge-reranker-v2-m3'])
  await assert.rejects(fetchModels({ kind: 'openai', baseUrl: 'https://x/v1', apiKey: 'bad', channel: 'llm', fetchImpl: async () => ({ ok: false, status: 401 }) }), /密钥不对/)
  await assert.rejects(fetchModels({ kind: 'openai', baseUrl: 'https://x/v1', apiKey: 'k', channel: 'llm', fetchImpl: async () => { throw new TypeError('fetch failed') } }), /网络不通/)
  ok('model listing: type filter, SiliconFlow sub_type, Chinese errors')
}
// --- client
{
  const c = readFileSync(new URL('../web/client.js', import.meta.url), 'utf8')
  assert.ok(!/h\("select"/.test(c), 'no native select left')
  assert.ok(/createPortal\(menu, document\.body\)/.test(c) && /data-ds-dark-theme/.test(c))
  assert.ok(c.includes('使用 dsh 的密钥') && c.includes('清除密钥') && c.includes('正在获取模型…'))
  assert.ok(!c.includes('prefers-color-scheme:dark'))
  ok('client: custom picker (portal), dsh theme, key-source text, 清除密钥')
}
console.log('\nv0.1.2 tests passed')
