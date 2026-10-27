/** default_bank → per-workspace mapping migration. Run: node tests/test-default-bank-migration.mjs */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.js'
import { resolveBankId } from '../lib/bank.js'
import { migrateDefaultBank, migrateWorkspaceLazily, loadMigration, planDefaultBankMigration } from '../lib/bankmigrate.js'

let passed = 0
function ok(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }
const dir = mkdtempSync(join(tmpdir(), 'dsh-bankmig-'))
const cfg = (bank) => resolveConfig({ bank, retain: { state_dir: dir } }, { env: {} }).config

try {
  ok('plan keeps explicit (exact/prefix) mappings and maps the rest', () => {
    const p = planDefaultBankMigration({ prefix_match: true, workspace_bank_mapping: { '/srv/a': 'mine', '/data': 'd' } }, ['/srv/a', '/srv/b', '/data/x', '/srv/b/'], 'shared')
    assert.deepEqual(p.added, ['/srv/b'])
    assert.equal(p.mapping['/srv/a'], 'mine')
    assert.equal(p.mapping['/srv/b'], 'shared')
    assert.equal(p.mapping['/data/x'], undefined)
  })

  ok('migration maps unmapped workspaces, clears default_bank and persists a record', () => {
    const c = cfg({ default_bank: 'team', workspace_bank_mapping: { '/srv/a': 'mine' } })
    const r = migrateDefaultBank(c, { workspacePaths: ['/srv/a', '/srv/b', '/srv/c'], complete: true })
    assert.deepEqual(r.added, ['/srv/b', '/srv/c'])
    assert.equal(c.bank.default_bank, '')
    assert.equal(c.bank.legacy_default_bank, 'team')
    assert.equal(resolveBankId({ workspacePath: '/srv/a', config: c }).bankId, 'mine', 'explicit kept')
    assert.equal(resolveBankId({ workspacePath: '/srv/b', config: c }).bankId, 'team', 'old memories stay reachable')
    assert.ok(existsSync(join(dir, 'bank-migration.json')))
    assert.equal(loadMigration(dir).complete, true)
  })

  ok('migration is idempotent across restarts (before the panel rewrote the config)', () => {
    const c = cfg({ default_bank: 'team', workspace_bank_mapping: { '/srv/a': 'mine' } })
    const r = migrateDefaultBank(c, { workspacePaths: ['/srv/a', '/srv/b', '/srv/c', '/srv/new'], complete: true })
    assert.deepEqual(r.added, [], 'nothing new once complete')
    assert.equal(c.bank.workspace_bank_mapping['/srv/b'], 'team')
    assert.equal(c.bank.workspace_bank_mapping['/srv/c'], 'team')
    assert.equal(c.bank.workspace_bank_mapping['/srv/new'], undefined, 'new workspaces get their own bank')
    assert.match(resolveBankId({ workspacePath: '/srv/new', config: c }).rule, /^template/)
    const again = migrateDefaultBank(c)
    assert.equal(again, null, 'already cleared: no-op')
  })

  ok('lazy migration maps a workspace seen before the registry list completes', () => {
    const d2 = mkdtempSync(join(tmpdir(), 'dsh-bankmig2-'))
    try {
      const c = resolveConfig({ bank: { default_bank: 'old' }, retain: { state_dir: d2 } }, { env: {} }).config
      migrateDefaultBank(c, { workspacePaths: [] })
      assert.equal(migrateWorkspaceLazily(c, '/w/one'), true)
      assert.equal(resolveBankId({ workspacePath: '/w/one', config: c }).bankId, 'old')
      assert.equal(migrateWorkspaceLazily(c, '/w/one'), false, 'idempotent')
      assert.equal(loadMigration(d2).mapping['/w/one'], 'old')
      migrateDefaultBank(resolveConfig({ bank: { default_bank: 'old' }, retain: { state_dir: d2 } }, { env: {} }).config, { workspacePaths: ['/w/one', '/w/two'], complete: true })
      const c3 = resolveConfig({ bank: { default_bank: 'old' }, retain: { state_dir: d2 } }, { env: {} }).config
      migrateDefaultBank(c3)
      assert.equal(migrateWorkspaceLazily(c3, '/w/three'), false, 'complete record stops lazy mapping')
      assert.equal(c3.bank.workspace_bank_mapping['/w/two'], 'old')
    } finally { rmSync(d2, { recursive: true, force: true }) }
  })
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log(`\n${passed} passed`)
