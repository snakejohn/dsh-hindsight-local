/** default_bank → per-workspace mapping migration. Run: node tests/test-default-bank-migration.mjs */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  ok('plan sends every workspace and every old mapping to the legacy bank', () => {
    const p = planDefaultBankMigration({ prefix_match: true, workspace_bank_mapping: { '/srv/a': 'mine', '/data': 'd' } }, ['/srv/a', '/srv/b', '/data/x', '/srv/b/'], 'shared')
    assert.deepEqual(p.added, ['/srv/b', '/data/x'])
    assert.equal(p.mapping['/srv/a'], 'shared', 'dormant explicit mapping repointed')
    assert.equal(p.mapping['/data'], 'shared', 'dormant prefix mapping repointed')
    assert.equal(p.mapping['/srv/b'], 'shared')
    assert.equal(p.mapping['/data/x'], 'shared')
    assert.deepEqual(p.replaced, { '/srv/a': 'mine', '/data': 'd' })
  })

  ok('migration maps every workspace (own mappings too) to the old shared bank and persists a record', () => {
    const c = cfg({ default_bank: 'team', workspace_bank_mapping: { '/srv/a': 'mine' } })
    const r = migrateDefaultBank(c, { workspacePaths: ['/srv/a', '/srv/b', '/srv/c'], complete: true })
    assert.deepEqual(r.added, ['/srv/b', '/srv/c'])
    assert.deepEqual(r.replaced, { '/srv/a': 'mine' })
    assert.equal(c.bank.default_bank, '')
    assert.equal(c.bank.legacy_default_bank, 'team')
    for (const w of ['/srv/a', '/srv/b', '/srv/c']) assert.equal(resolveBankId({ workspacePath: w, config: c }).bankId, 'team', `${w} recalls the old memories`)
    assert.ok(existsSync(join(dir, 'bank-migration.json')))
    const rec = loadMigration(dir)
    assert.equal(rec.complete, true)
    assert.equal(rec.v, 2)
    assert.equal(rec.mapping['/srv/a'], 'team')
    assert.deepEqual(rec.replaced, { '/srv/a': 'mine' })
  })

  ok('migration is idempotent across restarts (before the panel rewrote the config)', () => {
    const before = readFileSync(join(dir, 'bank-migration.json'), 'utf8')
    const c = cfg({ default_bank: 'team', workspace_bank_mapping: { '/srv/a': 'mine' } })
    const r = migrateDefaultBank(c, { workspacePaths: ['/srv/a', '/srv/b', '/srv/c', '/srv/new'], complete: true })
    assert.deepEqual(r.added, [], 'nothing new once complete')
    assert.deepEqual(r.replaced, {}, 'record already wins over the dormant entry')
    assert.equal(c.bank.workspace_bank_mapping['/srv/a'], 'team')
    assert.equal(c.bank.workspace_bank_mapping['/srv/b'], 'team')
    assert.equal(c.bank.workspace_bank_mapping['/srv/c'], 'team')
    assert.equal(c.bank.workspace_bank_mapping['/srv/new'], undefined, 'new workspaces get their own bank')
    assert.match(resolveBankId({ workspacePath: '/srv/new', config: c }).rule, /^template/)
    assert.equal(readFileSync(join(dir, 'bank-migration.json'), 'utf8'), before, 'record unchanged on restart')
    const again = migrateDefaultBank(c)
    assert.equal(again, null, 'already cleared: no-op')
  })

  ok('after the panel wrote the mapping and removed default_bank, migration never runs again', () => {
    const c = cfg({ workspace_bank_mapping: { '/srv/a': 'mine-again' } })
    assert.equal(migrateDefaultBank(c, { workspacePaths: ['/srv/a'], complete: true }), null)
    assert.equal(resolveBankId({ workspacePath: '/srv/a', config: c }).bankId, 'mine-again', 'later user choice respected')
  })

  ok('a v1 record (0.1.7: explicit mappings kept) is upgraded while default_bank is still set', () => {
    const d3 = mkdtempSync(join(tmpdir(), 'dsh-bankmig3-'))
    try {
      writeFileSync(join(d3, 'bank-migration.json'), JSON.stringify({ from: 'legacy', mapping: { '/w/a': 'legacy' }, complete: true, at: 'x' }))
      const c = resolveConfig({ bank: { default_bank: 'legacy', workspace_bank_mapping: { '/w/b': 'bk-own' } }, retain: { state_dir: d3 } }, { env: {} }).config
      const r = migrateDefaultBank(c, { workspacePaths: ['/w/a', '/w/b'], complete: true })
      assert.equal(resolveBankId({ workspacePath: '/w/b', config: c }).bankId, 'legacy')
      assert.deepEqual(r.replaced, { '/w/b': 'bk-own' })
      const rec = loadMigration(d3)
      assert.equal(rec.v, 2)
      assert.equal(rec.mapping['/w/b'], 'legacy')
    } finally { rmSync(d3, { recursive: true, force: true }) }
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
      // A workspace with its own (dormant) mapping is also sent to the old bank lazily.
      const d4 = mkdtempSync(join(tmpdir(), 'dsh-bankmig4-'))
      try {
        const c4 = resolveConfig({ bank: { default_bank: 'old' }, retain: { state_dir: d4 } }, { env: {} }).config
        migrateDefaultBank(c4, { workspacePaths: [] })
        c4.bank.workspace_bank_mapping = { '/w/own': 'mine' }
        assert.equal(migrateWorkspaceLazily(c4, '/w/own'), true)
        assert.equal(resolveBankId({ workspacePath: '/w/own', config: c4 }).bankId, 'old')
        assert.equal(loadMigration(d4).replaced['/w/own'], 'mine')
      } finally { rmSync(d4, { recursive: true, force: true }) }
    } finally { rmSync(d2, { recursive: true, force: true }) }
  })
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log(`\n${passed} passed`)
