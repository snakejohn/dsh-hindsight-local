/**
 * A bank created with 「新建库，自己起名…」 is offered as 「接入已有库」 in other workspaces right
 * away (before its first memory): created on Hindsight immediately with its Chinese name, listed
 * from the mapping while it is not on the server yet, and labelled with the workspaces using it.
 * Run: node tests/test-new-bank-join.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bankIdForName } from '../lib/bank.js'
import { createRpcHandler } from '../lib/rpc.js'
import { buildRuntime, createFakeClient } from './harness.mjs'

let passed = 0
const ok = (m) => { passed += 1; console.log('PASS ' + m) }
const owner = { principal: { kind: 'owner' } }
const NAME = '团队共享记忆'
const ID = bankIdForName(NAME)

/** Fake Hindsight bank store: PUT creates (empty), PATCH names. */
function bankServer() {
  const client = createFakeClient()
  const banks = new Map()
  client.ensureBank = async (id) => { if (!banks.has(id)) banks.set(id, { bank_id: id, name: id }); return { bankId: id, created: true } }
  client.listBanks = async () => [...banks.values()]
  client.bankProfile = async (id) => banks.get(id) || {}
  client.setBankName = async (id, name) => { banks.get(id).name = name }
  client.stats = async () => ({ total_nodes: 0 })
  return { client, banks }
}

{
  const { client, banks } = bankServer()
  const { runtime, config } = buildRuntime({ fakeClient: client })
  runtime.service.ready = true
  const handler = createRpcHandler({ ctx: {}, current: () => ({ runtime, config, rawConfig: {} }) })
  const r = await handler('createBank', { name: NAME }, undefined, owner)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual({ id: r.value.id, name: r.value.name, pending: r.value.pending }, { id: ID, name: NAME, pending: false })
  assert.equal(banks.get(ID).name, NAME, 'created on Hindsight with the original Chinese name')
  const list = await handler('banks', {}, undefined, owner)
  assert.deepEqual(list.value.banks.map((b) => [b.id, b.name]), [[ID, NAME]], 'listed before any memory exists')
  ok('createBank RPC creates the empty bank on Hindsight with its Chinese display name')
}

{
  // Saved mapping, server not reachable / bank not created yet: still listed (pending).
  const { client } = bankServer()
  const { runtime, config } = buildRuntime({ fakeClient: client, rawConfig: { bank: { workspace_bank_mapping: { '/w/b': NAME, '/w/c': 'dsh-old' } } } })
  const handler = createRpcHandler({ ctx: {}, current: () => ({ runtime, config, rawConfig: {} }) })
  runtime.service.ready = false
  const down = await handler('banks', {}, undefined, owner)
  assert.deepEqual(down.value.banks.map((b) => [b.id, b.name, b.pending]), [[ID, NAME, true], ['dsh-old', '', true]])
  runtime.service.ready = true
  const up = await handler('banks', {}, undefined, owner)
  assert.equal(up.value.available, true)
  assert.ok(up.value.banks.some((b) => b.id === ID && b.name === NAME && b.pending), 'mapping-only bank listed while server has none')
  // On backend ready every mapped bank is created on the server (idempotent).
  const made = await runtime.ensureMappedBanks()
  assert.deepEqual(made.sort(), [ID, 'dsh-old'].sort())
  const after = await handler('banks', {}, undefined, owner)
  const b = after.value.banks.find((x) => x.id === ID)
  assert.equal(b.name, NAME); assert.equal(!!b.pending, false, 'now a real (empty) bank on the server')
  assert.equal(after.value.banks.filter((x) => x.id === ID).length, 1, 'no duplicate')
  ok('banks RPC lists mapping-named banks before they exist; ensureMappedBanks creates them')
}

{
  // Panel: the selector of another workspace offers the new bank immediately (unsaved mapping).
  const src = readFileSync(fileURLToPath(new URL('../web/client.js', import.meta.url)), 'utf8')
  let loaded
  globalThis.document = { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } }
  new Function('window', src)({ __ModuleLoader__: { load: (m) => { loaded = m } } })
  const React = { createElement: () => null, Fragment: 'f', useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({}), useSyncExternalStore: () => ({}), useMemo: (f) => f(), useCallback: (f) => f }
  const mod = loaded.factory(() => React)
  const zh = { ownAuto: '新建库（自动命名）', ownBank: '新建库', ownNamed: '新建库，自己起名…', joinBank: '接入已有库', usedBy: '已被使用：', bankEmpty: '还没有记忆' }
  const t = (k) => zh[k] || k
  const list = [{ path: '/w/b', title: 'wsB', bank: 'dsh-wsb-1' }, { path: '/w/c', title: 'wsC', bank: 'dsh-wsc-2' }]
  // 1) just named in wsB, not saved, server has nothing yet.
  const mapping = { '/w/b': NAME }
  const joinable = mod.joinableBanks([], [NAME].concat(Object.values(mapping)))
  assert.deepEqual(joinable, [{ id: '', name: NAME, value: NAME, pending: true }], 'deduped by name')
  const optsC = mod.bankChoices({ t, path: '/w/c', mapping, list, manual: [], remote: [], joinable })
  const join = optsC.find((o) => o.label === '接入已有库 · ' + NAME)
  assert.ok(join, 'wsC can join it immediately: ' + JSON.stringify(optsC))
  assert.equal(join.value, NAME)
  assert.match(join.sub, /已被使用：wsB/); assert.match(join.sub, /还没有记忆/)
  const optsB = mod.bankChoices({ t, path: '/w/b', mapping, list, manual: [], remote: [], joinable })
  assert.equal(optsB.filter((o) => o.label.includes(NAME)).length, 1, 'creator sees it once (新建库 · 名字)')
  assert.equal(optsB.find((o) => o.label.includes(NAME)).label, '新建库 · ' + NAME)
  // 2) created on the server (empty) -> joined by id, Chinese label, users from mapping.
  const remoteList = [{ id: ID, name: NAME, stats: { total_nodes: 0 } }]
  const j2 = mod.joinableBanks(remoteList, [NAME])
  assert.equal(j2.length, 1, 'server entry and the typed name are one bank')
  const o2 = mod.bankChoices({ t, path: '/w/c', mapping, list, manual: [], remote: [ID], joinable: j2 }).find((o) => o.value === ID)
  assert.equal(o2.label, '接入已有库 · ' + NAME)
  assert.match(o2.sub, new RegExp(ID)); assert.match(o2.sub, /已被使用：wsB/)
  // 3) after wsC joined (mapping value = id), both are listed as users.
  const m3 = { '/w/b': NAME, '/w/c': ID }
  const o3 = mod.bankChoices({ t, path: '/w/a', mapping: m3, list, manual: [], remote: [ID], joinable: j2 }).find((o) => o.value === ID)
  assert.match(o3.sub, /已被使用：wsB、wsC/)
  ok('panel offers a just-created bank as 接入已有库 (Chinese name, used-by workspaces)')
}
console.log(`\n${passed} passed`)
