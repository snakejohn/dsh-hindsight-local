/**
 * Workspace -> bank routing.
 *
 * Rules (first match wins):
 *   1. `bank.default_bank` if set (forces every workspace into one shared bank).
 *   2. `bank.workspace_bank_mapping` exact path match.
 *   3. `bank.workspace_bank_mapping` directory-prefix match (longest prefix wins).
 *   4. `bank.name_template` rendered from the workspace path.
 *
 * A bank id is a stable function of the workspace path, so reopening the same
 * directory always lands in the same bank even after a DSH restart.
 */
import { createHash } from 'node:crypto'
import { basename, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export function normalizeWorkspacePath(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  let normal = resolve(text)
  if (normal.length > 1 && normal.endsWith(sep)) normal = normal.slice(0, -1)
  return normal
}

/** Bank ids are used in URLs: keep them lowercase, ASCII, and short. */
export function slugify(input, maxLength = 40) {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (!slug) return 'workspace'
  return slug.length > maxLength ? slug.slice(0, maxLength).replace(/[-.]+$/, '') : slug
}

/**
 * Bank id for a user-typed bank name. ASCII names keep the old slug (existing ids unchanged);
 * names with Chinese or other non-ASCII characters get `<ascii-part->bk-<hash>` so different
 * Chinese names never collapse into the same id. The original text becomes the display name.
 */
export function bankIdForName(value) {
  const text = String(value || '').trim()
  if (!/[^\x00-\x7f]/.test(text)) return slugify(text, 64)
  const ascii = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
  return `${ascii ? ascii + '-' : ''}bk-${shortHash(text)}`
}

export function shortHash(input, length = 8) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, length)
}

export function renderBankTemplate(template, workspacePath) {
  const normalized = normalizeWorkspacePath(workspacePath)
  const base = basename(normalized) || 'workspace'
  // Banks are keyed by workspace only: one workspace -> exactly one bank.
  const rendered = String(template || 'dsh-{slug}-{hash}')
    .replaceAll('{slug}', slugify(base))
    .replaceAll('{basename}', slugify(base))
    .replaceAll('{hash}', shortHash(normalized))
    .replaceAll('{workspace}', slugify(normalized.replaceAll(sep, '-'), 60))
  return slugify(rendered, 64) || `dsh-${shortHash(normalized)}`
}

/**
 * @param {{ workspacePath: string, config: object }} args
 * @returns {{ bankId: string, rule: 'default_bank'|'mapping-exact'|'mapping-prefix'|'template', matchedKey?: string }}
 */
export function resolveBankId({ workspacePath, config }) {
  const bank = config?.bank || {}
  const normalized = normalizeWorkspacePath(workspacePath)

  if (bank.default_bank) {
    return { bankId: bankIdForName(bank.default_bank), rule: 'default_bank', displayName: String(bank.default_bank).trim() }
  }

  const mapping = bank.workspace_bank_mapping || {}
  const entries = Object.entries(mapping).filter(([, value]) => typeof value === 'string' && value.trim())
  if (normalized) {
    for (const [key, value] of entries) {
      if (normalizeWorkspacePath(expandHome(key)) === normalized) {
        return { bankId: bankIdForName(value), rule: 'mapping-exact', matchedKey: key, displayName: String(value).trim() }
      }
    }
    let best = null
    if (bank.prefix_match !== false) {
      for (const [key, value] of entries) {
        const prefix = normalizeWorkspacePath(expandHome(key))
        if (!prefix || prefix === sep) continue
        if (normalized === prefix || normalized.startsWith(prefix + sep)) {
          if (!best || prefix.length > best.prefix.length) best = { prefix, key, value }
        }
      }
    }
    if (best) return { bankId: bankIdForName(best.value), rule: 'mapping-prefix', matchedKey: best.key, displayName: String(best.value).trim() }
  }

  const template = bank.name_template || 'dsh-{slug}-{hash}'
  const base = basename(normalized) || ''
  return { bankId: renderBankTemplate(template, normalized), rule: 'template:workspace', displayName: base }
}

function expandHome(value) {
  const text = String(value || '')
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) {
    // process.env.HOME is usually unset on Windows; os.homedir() works everywhere.
    const home = homedir()
    return text === '~' ? home : home + text.slice(1)
  }
  return text
}
