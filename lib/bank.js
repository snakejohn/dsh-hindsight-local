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

export function shortHash(input, length = 8) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, length)
}

export function renderBankTemplate(template, workspacePath, vars = {}) {
  const normalized = normalizeWorkspacePath(workspacePath)
  const base = basename(normalized) || 'workspace'
  // The hash covers the isolation key (workspace + preset/session), so two characters in
  // one directory never collide even when the template does not mention {preset}.
  const hashKey = [normalized, vars.preset ? `preset:${vars.preset}` : '', vars.session ? `session:${vars.session}` : '']
    .filter(Boolean)
    .join('#')
  const rendered = String(template || 'dsh-{slug}-{hash}')
    .replaceAll('{slug}', slugify(base))
    .replaceAll('{basename}', slugify(base))
    .replaceAll('{preset}', /[a-z0-9]/i.test(vars.preset || '') ? slugify(vars.preset, 24) : vars.preset ? 'char' : 'default') // CJK names -> 'char', the hash keeps them apart
    .replaceAll('{session}', slugify(vars.session || 'nosession', 24))
    .replaceAll('{hash}', shortHash(hashKey))
    .replaceAll('{workspace}', slugify(normalized.replaceAll(sep, '-'), 60))
  return slugify(rendered, 64) || `dsh-${shortHash(normalized)}`
}

/**
 * @param {{ workspacePath: string, config: object }} args
 * @returns {{ bankId: string, rule: 'default_bank'|'mapping-exact'|'mapping-prefix'|'template', matchedKey?: string }}
 */
export function resolveBankId({ workspacePath, config, preset = '', sessionId = '' }) {
  const bank = config?.bank || {}
  const scope = bank.scope || 'workspace'
  const vars = {
    preset: scope === 'preset' ? preset || 'default' : '',
    session: scope === 'session' ? sessionId || '' : ''
  }
  const normalized = normalizeWorkspacePath(workspacePath)

  if (bank.default_bank) {
    return { bankId: slugify(bank.default_bank, 64), rule: 'default_bank' }
  }

  const mapping = bank.workspace_bank_mapping || {}
  const entries = Object.entries(mapping).filter(([, value]) => typeof value === 'string' && value.trim())
  if (normalized) {
    for (const [key, value] of entries) {
      if (normalizeWorkspacePath(expandHome(key)) === normalized) {
        return { bankId: slugify(value, 64), rule: 'mapping-exact', matchedKey: key }
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
    if (best) return { bankId: slugify(best.value, 64), rule: 'mapping-prefix', matchedKey: best.key }
  }

  let template = bank.name_template
  if (!template || template === 'dsh-{slug}-{hash}') {
    if (scope === 'preset') template = 'dsh-{preset}-{hash}'
    else if (scope === 'session') template = 'dsh-{slug}-s-{hash}'
  }
  return { bankId: renderBankTemplate(template, normalized, vars), rule: `template:${scope}` }
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
