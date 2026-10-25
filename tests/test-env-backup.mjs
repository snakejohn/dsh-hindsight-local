// Reinstalling the plugin (remove + add from GitHub/tarball) replaces the package dir and its .env.
// Keys live only in .env now, so a copy outside the package must bring them back.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hs-envbak-root-'))
const bak = join(mkdtempSync(join(tmpdir(), 'hs-envbak-home-')), '.dsh-hindsight', 'plugin.env')
process.env.DSH_HINDSIGHT_PLUGIN_ROOT = root
process.env.DSH_HINDSIGHT_ENV_BACKUP = bak
const { writeDotenvKeys, dotenvKeyEnv, syncDotenv, readDotenv, BACKUP_PATH } = await import('../lib/dotenv.js')
const { clearDotenvKeys } = await import('../lib/keystate.js')
const envPath = join(root, '.env')
const A = 'test-key-embedding-0001', B = 'test-key-llm-0002'
let pass = 0
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name) }

await t('saving keys also writes the backup outside the plugin dir (0600)', () => {
  assert.equal(BACKUP_PATH(), bak)
  writeDotenvKeys({ 'embedding.api_key': A, 'llm.api_key': B })
  assert.ok(existsSync(bak))
  assert.equal(readFileSync(bak, 'utf8'), readFileSync(envPath, 'utf8'))
  if (process.platform !== 'win32') assert.equal(statSync(bak).mode & 0o777, 0o600)
})

await t('reinstall (plugin dir .env deleted) restores keys and retain options from the backup', () => {
  syncDotenv({ DSH_HINDSIGHT_RETAIN_TOOL_CALLS: 'true' })
  rmSync(envPath)
  assert.deepEqual(dotenvKeyEnv(), { DSH_HINDSIGHT_EMBEDDING_API_KEY: A, DSH_HINDSIGHT_LLM_API_KEY: B })
  assert.ok(existsSync(envPath))
  assert.equal(readDotenv().DSH_HINDSIGHT_RETAIN_TOOL_CALLS, 'true')
})

await t('an existing .env from before the backup existed gets backed up on the next sync', () => {
  rmSync(bak)
  syncDotenv({})
  assert.ok(existsSync(bak))
})

await t('clearing keys clears the backup too (no resurrection after reinstall)', () => {
  clearDotenvKeys()
  rmSync(envPath)
  assert.deepEqual(dotenvKeyEnv(), {})
})

await t('an explicit non-plugin path never touches the backup', () => {
  const before = readFileSync(bak, 'utf8')
  const other = join(root, 'other.env')
  writeFileSync(other, '')
  writeDotenvKeys({ 'llm.api_key': 'test-key-other-0003' }, { path: other })
  assert.equal(readFileSync(bak, 'utf8'), before)
})

console.log(`\n${pass} passed`)
