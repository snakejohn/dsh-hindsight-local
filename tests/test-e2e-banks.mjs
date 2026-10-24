/**
 * Bank binding end-to-end against a REAL Hindsight (needs an LLM on the server, so opt-in):
 *   DSH_TEST_HINDSIGHT_URL=http://127.0.0.1:8888 [DSH_TEST_HINDSIGHT_KEY=...] node tests/test-e2e-banks.mjs
 * Covers: per-workspace / preset / session routing, shared bank via mapping (A sees B, C does not),
 * same document_id re-sent = no duplicate document, recall never leaks across banks.
 * SKIPs (exit 0) without DSH_TEST_HINDSIGHT_URL. Test banks are deleted at the end.
 */
import assert from 'node:assert/strict'
import { HindsightClient } from '../lib/client.js'
import { resolveBankId } from '../lib/bank.js'
import { DEFAULT_CONFIG } from '../lib/config.js'

const BASE = process.env.DSH_TEST_HINDSIGHT_URL
if (!BASE) { console.log('SKIP set DSH_TEST_HINDSIGHT_URL to run bank e2e'); process.exit(0) }
const client = new HindsightClient({ baseUrl: BASE, apiKey: process.env.DSH_TEST_HINDSIGHT_KEY || '', timeoutMs: 300000, logger: { debug() {}, info() {}, warn() {} } })
if (!(await client.health({ timeoutMs: 3000 })).ok) { console.log(`SKIP no Hindsight at ${BASE}`); process.exit(0) }
const S = Date.now().toString(36)
const cfg = (bank) => ({ ...DEFAULT_CONFIG, bank: { ...DEFAULT_CONFIG.bank, ...bank } })
const created = new Set()
const write = async (bank, doc, text) => {
  created.add(bank); await client.ensureBank(bank)
  await client.retain(bank, [{ content: text, document_id: doc, timestamp: new Date().toISOString() }], { async: false })
}
const docs = async (bank) => { const r = await client.call(client.bankPath(bank, '/documents')); return (r.json?.items || []).map((d) => d.id).sort() }
const recallText = async (bank, q) => JSON.stringify((await client.recall(bank, { query: q, budget: 'mid', max_tokens: 2048 }, { force: true }))?.results || [])
let pass = 0
const ok = (n) => { pass++; console.log('PASS', n) }
try {
  // A1 workspace isolation
  const wa = `/e2e-${S}/notes`, wb = `/e2e-${S}/blog`, wc = `/e2e-${S}/other`
  const ba = resolveBankId({ workspacePath: wa, config: cfg({}) }).bankId
  const bb = resolveBankId({ workspacePath: wb, config: cfg({}) }).bankId
  assert.notEqual(ba, bb)
  await write(ba, 'a:t0', 'USER: My secret fruit is dragonfruit. ASSISTANT: Noted.')
  await write(bb, 'b:t0', 'USER: My blog theme is called Midnight Lantern. ASSISTANT: Nice.')
  assert.match(await recallText(ba, 'What is my secret fruit?'), /dragonfruit/i)
  assert.doesNotMatch(await recallText(bb, 'What is my secret fruit?'), /dragonfruit/i)
  ok('A1 per-workspace banks, no leak')
  // A2 preset / session scopes route to distinct banks
  const p1 = resolveBankId({ workspacePath: wa, config: cfg({ scope: 'preset' }), preset: 'alice' }).bankId
  const p2 = resolveBankId({ workspacePath: wa, config: cfg({ scope: 'preset' }), preset: 'bob' }).bankId
  const s1 = resolveBankId({ workspacePath: wa, config: cfg({ scope: 'session' }), sessionId: 's1' }).bankId
  const s2 = resolveBankId({ workspacePath: wa, config: cfg({ scope: 'session' }), sessionId: 's2' }).bankId
  assert.equal(new Set([p1, p2, s1, s2, ba]).size, 5)
  await write(p1, 'p1:t0', 'USER: I am Alice and my favourite colour is violet. ASSISTANT: Got it.')
  assert.deepEqual(await docs(p1), ['p1:t0']); assert.deepEqual(await docs(p2).catch(() => []), [])
  ok('A2 preset/session scopes write to their own bank')
  // A3 shared bank through mapping
  const shared = `dsh-e2e-shared-${S}`
  const map = cfg({ workspace_bank_mapping: { [wa]: shared, [wb]: shared } })
  assert.equal(resolveBankId({ workspacePath: wa, config: map }).bankId, shared)
  assert.equal(resolveBankId({ workspacePath: wb, config: map }).bankId, shared)
  const bc = resolveBankId({ workspacePath: wc, config: map }).bankId
  assert.notEqual(bc, shared)
  await write(shared, 'b2:t0', 'USER: The new blog domain is lantern-notes.dev. ASSISTANT: Remember DNS.')
  assert.match(await recallText(resolveBankId({ workspacePath: wa, config: map }).bankId, 'What is the new blog domain?'), /lantern-notes/i)
  await write(bc, 'c:t0', 'USER: I like tea. ASSISTANT: OK.')
  assert.doesNotMatch(await recallText(bc, 'What is the new blog domain?'), /lantern-notes/i)
  ok('A3 shared bank: A sees B, unmapped C does not')
  // A4 old memories stay where they were; re-sending a document id does not duplicate
  assert.deepEqual(await docs(ba), ['a:t0'])
  await write(shared, 'b2:t0', 'USER: The new blog domain is lantern-notes.dev. ASSISTANT: Remember DNS.')
  assert.deepEqual(await docs(shared), ['b2:t0'])
  ok('A4 mapping change leaves old bank intact; same document_id is an upsert')
} finally {
  for (const b of created) await client.call(client.bankPath(b), { method: 'DELETE' }).catch(() => {})
}
console.log(`${pass} pass`)
