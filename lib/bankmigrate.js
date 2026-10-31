/**
 * Migration of the legacy `bank.default_bank` setting (one bank forced on every workspace).
 *
 * Hard rule: each workspace binds to exactly one bank; workspaces share a bank only by picking
 * the same one in `bank.workspace_bank_mapping`. There is no global shared toggle any more.
 *
 * In old versions a non-empty `default_bank` overrode every per-workspace mapping, so every
 * workspace wrote into that one shared bank and any explicit mapping was dormant (its bank is
 * empty). On load, a non-empty `default_bank` is therefore turned into explicit mappings that
 * send EVERY workspace to that old shared bank: each known workspace gets an exact mapping to it
 * and every existing mapping entry (exact or prefix) is repointed to it, so recall after the
 * upgrade finds exactly what was written before. The replaced values are kept in the record
 * (`replaced`) for reference. Routing never reads `default_bank` afterwards. The result is recorded in
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
    return v && typeof v === 'object' && typeof v.from === 'string' ? { from: v.from, mapping: isObj(v.mapping) ? v.mapping : {}, replaced: isObj(v.replaced) ? v.replaced : {}, complete: !!v.complete, at: v.at || '', ...(v.v ? { v: v.v } : {}) } : null
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
 * Pure: mapping that sends every listed workspace and every existing mapping entry to `bank`.
 * @returns {{ mapping: object, added: string[], replaced: object }} added = paths whose routing
 *   changed (new entries or repointed ones); replaced = { key: previous value } for repointed entries.
 */
export function planDefaultBankMigration(bankCfg, workspacePaths, bank) {
  const target = String(bank || '').trim()
  const mapping = { ...(isObj(bankCfg?.workspace_bank_mapping) ? bankCfg.workspace_bank_mapping : {}) }
  const added = []
  const replaced = {}
  if (!target) return { mapping, added, replaced }
  // Old routing: default_bank won over every mapping, so these entries were never used.
  for (const [k, v] of Object.entries(mapping)) {
    if (typeof v === 'string' && v.trim() && v.trim() !== target) { replaced[k] = v; mapping[k] = target }
  }
  for (const raw of workspacePaths || []) {
    const path = normalizeWorkspacePath(raw)
    if (!path) continue
    if (mapping[path] === target) continue
    const prev = mapping[path]
    if (typeof prev === 'string' && prev.trim()) replaced[path] = prev
    mapping[path] = target
    added.push(path)
  }
  return { mapping, added, replaced }
}

/** Current record format: v2 = every workspace goes to the legacy bank (v1 kept explicit mappings). */
export const MIGRATION_VERSION = 2

/**
 * Apply the migration to a resolved config in place (idempotent).
 * - `workspacePaths`: workspaces known now (dsh's workspaceRegistry); `complete` marks that the
 *   whole list was seen, after which brand-new workspaces get their own bank as usual.
 * While `default_bank` is still in the config (panel not opened yet) every restart re-applies the
 * recorded result, so routing is the same on every start. Returns what changed, or null.
 */
export function migrateDefaultBank(config, { stateDir = config?.retain?.state_dir || '', workspacePaths = [], complete = false } = {}) {
  const bank = config?.bank
  if (!bank) return null
  const legacy = String(bank.default_bank || '').trim()
  if (!legacy) return null
  let record = loadMigration(stateDir)
  if (!record || record.from !== legacy) record = { from: legacy, mapping: {}, replaced: {}, complete: false, at: new Date().toISOString() }
  const upgraded = record.v !== MIGRATION_VERSION
  record.v = MIGRATION_VERSION
  if (!isObj(record.replaced)) record.replaced = {}
  // Recorded mappings win over the live config's (dormant) entries, then everything is repointed.
  const merged = { ...(isObj(bank.workspace_bank_mapping) ? bank.workspace_bank_mapping : {}), ...record.mapping }
  const paths = [...Object.keys(record.mapping), ...(record.complete ? [] : workspacePaths)]
  const plan = planDefaultBankMigration({ ...bank, workspace_bank_mapping: merged }, paths, legacy)
  // Live-config entries repointed to the legacy bank are part of the record too (survive restarts).
  let changed = upgraded
  for (const [k, v] of Object.entries(plan.mapping)) {
    if (v === legacy && record.mapping[k] !== legacy) { record.mapping[k] = legacy; changed = true }
  }
  for (const [k, v] of Object.entries(plan.replaced)) if (!(k in record.replaced)) { record.replaced[k] = v; changed = true }
  const wasComplete = record.complete
  record.complete = record.complete || !!complete
  const file = migrationPath(stateDir)
  if (changed || record.complete !== wasComplete || (file && !existsSync(file))) saveMigration(stateDir, record)
  bank.workspace_bank_mapping = plan.mapping
  bank.legacy_default_bank = legacy
  bank.default_bank = ''
  return { from: legacy, added: plan.added, replaced: plan.replaced, complete: record.complete, mapping: plan.mapping }
}

/** Lazy step for a workspace first seen before the full list was available. */
export function migrateWorkspaceLazily(config, workspacePath, { stateDir = config?.retain?.state_dir || '' } = {}) {
  const legacy = String(config?.bank?.legacy_default_bank || '').trim()
  if (!legacy) return false
  const record = loadMigration(stateDir)
  if (record && record.from === legacy && record.complete) return false
  const path = normalizeWorkspacePath(workspacePath)
  if (!path) return false
  const current = config.bank.workspace_bank_mapping?.[path]
  if (current === legacy) return false
  const r = record && record.from === legacy ? record : { from: legacy, mapping: {}, replaced: {}, complete: false, at: new Date().toISOString() }
  r.v = MIGRATION_VERSION
  if (!isObj(r.replaced)) r.replaced = {}
  if (typeof current === 'string' && current.trim() && !(path in r.replaced)) r.replaced[path] = current
  config.bank.workspace_bank_mapping = { ...config.bank.workspace_bank_mapping, [path]: legacy }
  r.mapping[path] = legacy
  saveMigration(stateDir, r)
  return true
}

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
