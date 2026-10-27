// Setup must survive volatile cordis.patch.yml rewrites (form save / hand-edit that drops `setup`).
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hs-setup-'))
process.env.DSH_HINDSIGHT_PLUGIN_ROOT = root
const home = mkdtempSync(join(tmpdir(), 'hs-home-'))
const data = join(home, '.dsh-hindsight')
mkdirSync(join(data, 'venv'), { recursive: true })
writeFileSync(join(data, 'venv', 'dsh-installed.txt'), 'ok\n')

const { resolveConfig, setupEnv, inferCompletedLocalSetup, retainEnv } = await import('../lib/config.js')
const { syncDotenv, dotenvKeyEnv, readDotenv, writeDotenvKeys } = await import('../lib/dotenv.js')
const { needsSetup, sidebarStatus } = await import('../lib/rpc.js')

let pass = 0
const t = async (name, fn) => { await fn(); pass++; console.log('PASS', name) }

await t('setupEnv only emits local/existing', () => {
  assert.deepEqual(setupEnv({ setup: 'local' }), { DSH_HINDSIGHT_SETUP: 'local' })
  assert.deepEqual(setupEnv({ setup: 'existing' }), { DSH_HINDSIGHT_SETUP: 'existing' })
  assert.deepEqual(setupEnv({ setup: 'unset' }), {})
  assert.deepEqual(setupEnv({}), {})
})

await t('syncDotenv persists DSH_HINDSIGHT_SETUP', () => {
  const r = syncDotenv({ ...retainEnv({ retain: { user: true, assistant: true, tool_calls: false, max_tool_chars: 2000, reasoning: false, system: false, archived: false, subagents: false, min_chars: 1 } }), ...setupEnv({ setup: 'local' }) })
  assert.equal(r.error, '')
  assert.equal(readDotenv().DSH_HINDSIGHT_SETUP, 'local')
  assert.equal(dotenvKeyEnv().DSH_HINDSIGHT_SETUP, 'local')
})

await t('resolveConfig heals setup from .env when patch lost it', () => {
  // Simulate: form.mutate / hand-edit dropped setup from the volatile overlay.
  const { config } = resolveConfig(
    { setup: 'unset', service: { mode: 'auto', local: { port: 8899 } }, embedding: { provider: 'openai' } },
    { env: { ...dotenvKeyEnv(), DSH_HINDSIGHT_EMBEDDING_API_KEY: 'test-key-heal-0001' }, home }
  )
  assert.equal(config.setup, 'local')
  assert.equal(config.service.mode, 'local')
  assert.equal(config.service.autostart, true)
  assert.equal(config.service.base_url, 'http://127.0.0.1:8899')
  assert.equal(needsSetup(config), false)
})

await t('explicit setup in patch is not clobbered by a stale .env SETUP', () => {
  const { config } = resolveConfig(
    { setup: 'existing', service: { mode: 'attach', base_url: 'http://127.0.0.1:9999' } },
    { env: { DSH_HINDSIGHT_SETUP: 'local' } }
  )
  assert.equal(config.setup, 'existing')
  assert.equal(config.service.mode, 'attach')
  assert.equal(config.service.autostart, false)
})

await t('inferCompletedLocalSetup uses venv marker + embedding key (no SETUP line yet)', () => {
  assert.equal(inferCompletedLocalSetup({}, {}, { home, exists: undefined }), false, 'no key → false')
  assert.equal(
    inferCompletedLocalSetup({}, { DSH_HINDSIGHT_EMBEDDING_API_KEY: 'k' }, { home }),
    true,
    'venv + key → true'
  )
  const emptyHome = mkdtempSync(join(tmpdir(), 'hs-empty-'))
  assert.equal(
    inferCompletedLocalSetup({}, { DSH_HINDSIGHT_EMBEDDING_API_KEY: 'k' }, { home: emptyHome }),
    false,
    'key but no venv → false'
  )
})

await t('resolveConfig heals from local install evidence when .env has no SETUP yet', () => {
  // Fresh plugin .env without DSH_HINDSIGHT_SETUP (upgrade path for users who already hit the bug).
  writeFileSync(join(root, '.env'), 'DSH_HINDSIGHT_EMBEDDING_API_KEY=test-key-infer-0002\n', { mode: 0o600 })
  const { config } = resolveConfig(
    { setup: 'unset', service: { mode: 'auto', local: { port: 8899 } } },
    { env: { ...dotenvKeyEnv() }, home }
  )
  assert.equal(config.setup, 'local')
  assert.equal(needsSetup(config), false)
})

await t('sidebar stays off 「需要设置」 after heal', async () => {
  const { config } = resolveConfig(
    { setup: 'unset', enabled: true, service: { mode: 'auto' } },
    { env: { DSH_HINDSIGHT_SETUP: 'local', DSH_HINDSIGHT_EMBEDDING_API_KEY: 'k' }, home }
  )
  const v = await sidebarStatus({
    config,
    runtime: { service: { ready: false, state: 'starting', deploy: { steps: [] } }, recent: [], activity: {}, client: { stats: async () => ({}) } }
  })
  assert.notEqual(v.text, '需要设置')
  assert.equal(v.level, 'yellow')
})

await t('panel client re-asserts setup on mutateKeys and heals from overview', () => {
  const src = readFileSync(new URL('../web/client.js', import.meta.url), 'utf8')
  assert.match(src, /completed setup choice so a settings save never drops/)
  assert.match(src, /path: \["setup"\], value: setupNow/)
  assert.match(src, /healed = ovS && \(ovS\.setup === "local"/)
  assert.match(src, /form\.mutate\(\[\{ op: "set", path: \["setup"\], value: healed \}\]\)/)
  const dotenvSrc = readFileSync(new URL('../lib/dotenv.js', import.meta.url), 'utf8')
  assert.match(dotenvSrc, /DSH_HINDSIGHT_SETUP/)
})

console.log(`${pass} passed`)
