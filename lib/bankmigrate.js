/**
 * Migration of the legacy `bank.default_bank` setting (one bank forced on every workspace).
 *
 * Hard rule: each workspace binds to exactly one bank; workspaces share a bank only by picking
 * the same one in `bank.workspace_bank_mapping`. There is no global shared toggle any more.
 *
 * On load, a non-empty `default_bank` is turned into explicit mappings: every workspace without
 * an explicit mapping (exact or prefix) gets mapped to that bank, explicit mappings are kept.
 * Routing never reads `default_bank` afterwards. The result is recorded in
 * `<state_dir>/bank-migration.json` so it survives restarts even before the panel has rewritten
 * dsh's config (the panel then writes the mapping and unsets `default_bank` for good).
 * Nothing is deleted: the old shared bank keeps every memory and stays mapped.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeWorkspacePath, resolveBankId } from './bank.js'
import { writeFileAtomic } from './atomic.js'

export const MIGRATION_FILE = 'bank-migration.json'

export function migrationPath(stateDir) {
  return stateDir ? join(stateDir, MIGRATION_FILE) : ''
}

export function loadMigration(stateDir) {
  const file = migrationPath(stateDir)
  if (!file || !existsSync(file)) return null
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && typeof v.from === 'string' ? { from: v.from, mapping: isObj(v.mapping) ? v.mapping : {}, complete: !!v.complete, at: v.at || '' } : null
  } catch { return null }
}

export function saveMigration(stateDir, record) {
  const file = migrationPath(stateDir)
  if (!file) return false
  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileAtomic(file, JSON.stringify(record, null, 2) + '\n')
    return true
  } catch { return false }
}

/** true when the workspace already has an explicit mapping (exact or prefix). */
export function hasExplicitMapping(bankCfg, workspacePath) {
  const rule = resolveBankId({ workspacePath, config: { bank: { ...bankCfg, default_bank: '' } } }).rule
  return rule === 'mapping-exact' || rule === 'mapping-prefix'
}

/**
 * Pure: mappings to add so every listed workspace without an explicit mapping lands in `bank`.
 * @returns {{ mapping: object, added: string[] }} merged mapping (explicit entries untouched)
 */
export function planDefaultBankMigration(bankCfg, workspacePaths, bank) {
  const target = String(bank || '').trim()
  const mapping = { ...(isObj(bankCfg?.workspace_bank_mapping) ? bankCfg.workspace_bank_mapping : {}) }
  const added = []
  if (!target) return { mapping, added }
  for (const raw of workspacePaths || []) {
    const path = normalizeWorkspacePath(raw)
    if (!path || path in mapping) continue
    if (hasExplicitMapping({ ...bankCfg, workspace_bank_mapping: mapping }, path)) continue
    mapping[path] = target
    added.push(path)
  }
  return { mapping, added }
}

/**
 * Apply the migration to a resolved config in place (idempotent).
 * - `workspacePaths`: workspaces known now (dsh's workspaceRegistry); `complete` marks that the
 *   whole list was seen, after which brand-new workspaces get their own bank as usual.
 * Returns what changed, or null when there is nothing to migrate.
 */
export function migrateDefaultBank(config, { stateDir = config?.retain?.state_dir || '', workspacePaths = [], complete = false } = {}) {
  const bank = config?.bank
  if (!bank) return null
  const legacy = String(bank.default_bank || '').trim()
  if (!legacy) return null
  let record = loadMigration(stateDir)
  if (!record || record.from !== legacy) record = { from: legacy, mapping: {}, complete: false, at: new Date().toISOString() }
  // Recorded mappings first (explicit ones in the live config still win), then new workspaces.
  const merged = { ...(isObj(bank.workspace_bank_mapping) ? bank.workspace_bank_mapping : {}) }
  for (const [k, v] of Object.entries(record.mapping)) if (!(k in merged) && !hasExplicitMapping({ ...bank, workspace_bank_mapping: merged }, k)) merged[k] = v
  // Once the full workspace list was migrated, workspaces created later get their own bank.
  const plan = planDefaultBankMigration({ ...bank, workspace_bank_mapping: merged }, record.complete ? [] : workspacePaths, legacy)
  for (const p of plan.added) record.mapping[p] = legacy
  const wasComplete = record.complete
  record.complete = record.complete || !!complete
  const file = migrationPath(stateDir)
  if (plan.added.length || record.complete !== wasComplete || (file && !existsSync(file))) saveMigration(stateDir, record)
  bank.workspace_bank_mapping = plan.mapping
  bank.legacy_default_bank = legacy
  bank.default_bank = ''
  return { from: legacy, added: plan.added, complete: record.complete, mapping: plan.mapping }
}

/** Lazy step for a workspace first seen before the full list was available. */
export function migrateWorkspaceLazily(config, workspacePath, { stateDir = config?.retain?.state_dir || '' } = {}) {
  const legacy = String(config?.bank?.legacy_default_bank || '').trim()
  if (!legacy) return false
  const record = loadMigration(stateDir)
  if (record && record.from === legacy && record.complete) return false
  const path = normalizeWorkspacePath(workspacePath)
  if (!path || hasExplicitMapping(config.bank, path)) return false
  config.bank.workspace_bank_mapping = { ...config.bank.workspace_bank_mapping, [path]: legacy }
  const r = record && record.from === legacy ? record : { from: legacy, mapping: {}, complete: false, at: new Date().toISOString() }
  r.mapping[path] = legacy
  saveMigration(stateDir, r)
  return true
}

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
