// v0.1.3: ASCII bank ids, readable (Chinese) display names; crash-safe state writes.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveBankId, bankIdForName, slugify } from '../lib/bank.js'
import { writeFileAtomic } from '../lib/atomic.js'
import { buildRuntime, createFakeClient } from './harness.mjs'
const ok = (m) => console.log('PASS ' + m)

assert.equal(bankIdForName('dsh-shared'), 'dsh-shared', 'ASCII names keep their old id')
assert.equal(bankIdForName('My Bank'), slugify('My Bank', 64))
const a = bankIdForName('我的小说库'), b = bankIdForName('我的日记库')
assert.match(a, /^bk-[0-9a-f]{8}$/); assert.notEqual(a, b, 'different Chinese names never collide')
assert.match(bankIdForName('小说 v2'), /^v2-bk-[0-9a-f]{8}$/)
const cfg = { bank: { scope: 'workspace', workspace_bank_mapping: { '/tmp/甲': '我的小说库', '/tmp/乙': '我的小说库', '/tmp/丙': 'dsh-old' } } }
const r1 = resolveBankId({ workspacePath: '/tmp/甲', config: cfg }), r2 = resolveBankId({ workspacePath: '/tmp/乙', config: cfg })
assert.equal(r1.bankId, r2.bankId, 'N:1 — two workspaces, one bank'); assert.equal(r1.displayName, '我的小说库')
assert.equal(resolveBankId({ workspacePath: '/tmp/丙', config: cfg }).bankId, 'dsh-old', 'existing mapping id unchanged')
const auto = resolveBankId({ workspacePath: '/tmp/角色扮演-白雪', config: { bank: {} } })
assert.match(auto.bankId, /^[a-z0-9._-]+$/); assert.equal(auto.displayName, '角色扮演-白雪')
ok('ASCII-safe ids, Chinese display names, N:1 mapping, old ids preserved')

{
  const client = createFakeClient()
  const names = {}
  client.bankProfile = async (id) => ({ bank_id: id, name: names[id] || id })
  client.setBankName = async (id, n) => { names[id] = n }
  const { runtime } = buildRuntime({ fakeClient: client })
  assert.equal(await runtime.nameBank('bk-1', '我的小说库'), true)
  assert.equal(names['bk-1'], '我的小说库')
  runtime.namedBanks.clear()
  assert.equal(await runtime.nameBank('bk-1', '别的名字'), false, 'a named bank keeps its first name')
  assert.equal(names['bk-1'], '我的小说库')
  ok('display name set once (only when unnamed), shared banks keep their name')
}

{
  // 「接入已有库」 stores the bank id as the mapping value: the sidebar must still show the
  // bank's Chinese name, not "bk-…".
  const { sidebarStatus } = await import('../lib/rpc.js')
  const client = createFakeClient()
  const names = { 'bk-66955c9b': '团队共享记忆' }
  client.bankProfile = async (id) => ({ bank_id: id, name: names[id] || id })
  client.setBankName = async (id, n) => { names[id] = n }
  const { runtime, config } = buildRuntime({ fakeClient: client })
  assert.equal(await runtime.nameBank('bk-66955c9b', 'bk-66955c9b'), false, 'a joined bank is never renamed to its id')
  assert.equal(names['bk-66955c9b'], '团队共享记忆')
  assert.equal(runtime.bankNames.get('bk-66955c9b'), '团队共享记忆', 'server display name learned')
  runtime.workspaces.set('/tmp/中文区', { cwd: '/tmp/中文区', bankId: 'bk-66955c9b', rule: 'mapping-exact', displayName: 'bk-66955c9b' })
  runtime.recent.unshift({ at: new Date().toISOString(), bank: 'bk-66955c9b', turns: 1 })
  if (typeof sidebarStatus === 'function') {
    const s = await sidebarStatus({ runtime, config, rawConfig: {} })
    assert.equal(s.bankName, '团队共享记忆', 'sidebar shows the Chinese bank name for a joined bank')
  }
  ok('joined-by-id bank shows its Chinese display name')
}

{
  const dir = mkdtempSync(join(tmpdir(), 'atomic-'))
  const f = join(dir, 's.json')
  for (let i = 0; i < 50; i++) writeFileAtomic(f, JSON.stringify({ i, pad: 'x'.repeat(1000) }))
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).i, 49)
  assert.deepEqual(readdirSync(dir), ['s.json'], 'no temp files left behind')
  ok('atomic state writes (temp + rename)')
}
