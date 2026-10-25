/** bank.scope (preset/session) removed — old configs migrate to per-workspace banks. */
import assert from 'node:assert/strict'
import { resolveConfig } from '../lib/config.js'
import { resolveBankId, renderBankTemplate, shortHash } from '../lib/bank.js'
let pass = 0
const ok = (n) => { pass++; console.log('PASS', n) }

for (const scope of ['preset', 'session']) {
  const { config, warnings } = resolveConfig({ bank: { scope } }, { env: {} })
  assert.equal(config.bank.scope, undefined)
  assert.ok(warnings.some((w) => w.includes('bank.scope') && w.includes(scope)))
  ok(`inline scope=${scope} dropped with warning`)
}
{
  const { config, warnings } = resolveConfig({}, { env: { DSH_HINDSIGHT_BANK_SCOPE: 'preset' } })
  assert.equal(config.bank.scope, undefined)
  assert.ok(warnings.some((w) => w.includes('bank.scope')))
  ok('legacy DSH_HINDSIGHT_BANK_SCOPE env ignored with warning')
}
{
  const { warnings } = resolveConfig({ bank: { scope: 'workspace' } }, { env: {} })
  assert.ok(!warnings.some((w) => w.includes('bank.scope')))
  ok('scope=workspace migrates silently')
}
{
  // Mappings survive: a workspace can join an old preset/session bank by id.
  const old = 'dsh-char-1a2b3c4d'
  const { config } = resolveConfig({ bank: { scope: 'preset', workspace_bank_mapping: { '/w/a': old, '/w/b': old } } }, { env: {} })
  assert.equal(resolveBankId({ workspacePath: '/w/a', config }).bankId, old)
  assert.equal(resolveBankId({ workspacePath: '/w/b', config }).bankId, old)
  ok('workspaces can join an existing (legacy) bank and share it')
}
{
  // Auto bank ids for workspaces are unchanged from v0.1.4 (hash of the normalized path).
  const w = '/home/u/proj'
  assert.equal(renderBankTemplate('dsh-{slug}-{hash}', w), `dsh-proj-${shortHash(w)}`)
  ok('workspace bank id stable across upgrade')
}
console.log(`${pass} pass`)
