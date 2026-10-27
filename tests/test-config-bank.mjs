/**
 * Unit tests: config resolution + workspace/bank routing.
 * Run: node tests/test-config-bank.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig, DEFAULT_CONFIG, deepMerge, serviceEnv } from '../lib/config.js'
import { resolveBankId, renderBankTemplate, slugify, normalizeWorkspacePath, shortHash } from '../lib/bank.js'

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

ok('defaults are complete and immutable across calls', () => {
  const a = resolveConfig({}, { env: {} })
  const b = resolveConfig({}, { env: {} })
  assert.equal(a.config.recall.max_tokens, DEFAULT_CONFIG.recall.max_tokens)
  a.config.recall.max_tokens = 1
  assert.equal(b.config.recall.max_tokens, DEFAULT_CONFIG.recall.max_tokens)
  assert.equal(a.warnings.length, 0)
})

ok('nested inline config overrides without dropping siblings', () => {
  const { config } = resolveConfig({ recall: { top_n: 3 }, service: { base_url: 'http://127.0.0.1:9999/' } }, { env: {} })
  assert.equal(config.recall.top_n, 3)
  assert.equal(config.recall.max_tokens, 1200)
  assert.equal(config.service.base_url, 'http://127.0.0.1:9999')
  assert.equal(config.service.api_prefix, '/v1/default')
})

ok('env overrides win over inline config, with type coercion', () => {
  const { config, warnings } = resolveConfig(
    { recall: { top_n: 9 }, bank: { name_template: 'inline-{slug}' } },
    {
      env: {
        DSH_HINDSIGHT_BASE_URL: 'http://127.0.0.1:18888/',
        DSH_HINDSIGHT_RECALL_TOP_N: '2',
        DSH_HINDSIGHT_ENABLED: 'false',
        DSH_HINDSIGHT_BANK_TEMPLATE: 'env-{slug}',
        DSH_HINDSIGHT_BANK_MAPPING: '{"\/srv\/one":"shared-bank"}',
        DSH_HINDSIGHT_KEEP_RECENT_TURNS: '4',
        DSH_HINDSIGHT_RECALL_TYPES: 'world,experience'
      }
    }
  )
  assert.equal(config.enabled, false)
  assert.equal(config.recall.top_n, 2)
  assert.equal(config.service.base_url, 'http://127.0.0.1:18888')
  assert.equal(config.bank.name_template, 'env-{slug}')
  assert.deepEqual(config.bank.workspace_bank_mapping, { '/srv/one': 'shared-bank' })
  assert.equal(config.prune.keep_recent_turns, 4)
  assert.ok(config.prune.trigger_after_turns > 4)
  assert.deepEqual(config.recall.types, ['world', 'experience'])
  assert.equal(warnings.length, 0)
})

ok('invalid values warn instead of throwing', () => {
  const { config, warnings } = resolveConfig(
    { service: { mode: 'teleport' }, recall: { budget: 'huge' }, bank: { workspace_bank_mapping: 'nope' } },
    { env: { DSH_HINDSIGHT_RECALL_TOP_N: 'not-a-number', DSH_HINDSIGHT_BANK_MAPPING: '{broken' } }
  )
  assert.equal(config.service.mode, 'auto')
  assert.equal(config.recall.budget, 'mid')
  assert.equal(config.recall.top_n, 6)
  assert.deepEqual(config.bank.workspace_bank_mapping, {})
  assert.ok(warnings.length >= 4, `expected warnings, got ${JSON.stringify(warnings)}`)
})

ok('deepMerge keeps arrays and replaces scalars', () => {
  const merged = deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { b: 2 }, d: undefined })
  assert.deepEqual(merged, { a: { b: 2, c: [1, 2] }, d: 1 })
})

ok('serviceEnv maps embedding/reranker/llm config onto Hindsight env keys', () => {
  const { config } = resolveConfig(
    {
      embedding: { provider: 'openai', base_url: 'http://emb/v1', model: 'bge-m3', dimensions: 1024, batch_size: 16 },
      reranker: { provider: 'cohere', base_url: 'http://rr/rerank', model: 'rr-8b' },
      llm: { provider: 'openai', base_url: 'http://llm/v1', model: 'gemini-flash', temperature: 0.3 },
      service: { env_extra: { TZ: 'Asia/Shanghai' } }
    },
    { env: {} }
  )
  const env = serviceEnv(config, { debug: () => {} })
  assert.equal(env.HINDSIGHT_API_EMBEDDINGS_PROVIDER, 'openai')
  assert.equal(env.HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL, 'http://emb/v1')
  assert.equal(env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS, '1024')
  assert.equal(env.HINDSIGHT_API_RERANKER_COHERE_MODEL, 'rr-8b')
  assert.equal(env.HINDSIGHT_API_LLM_MODEL, 'gemini-flash')
  assert.equal(env.HINDSIGHT_API_LLM_TEMPERATURE, '0.3')
  assert.equal(env.TZ, 'Asia/Shanghai')
  assert.equal(env.HINDSIGHT_API_LLM_API_KEY, undefined, 'empty api key must not be exported')
})

ok('bank template is deterministic per workspace path', () => {
  const a = renderBankTemplate('dsh-{slug}-{hash}', '/srv/projects/alpha')
  const b = renderBankTemplate('dsh-{slug}-{hash}', '/srv/projects/alpha/')
  const c = renderBankTemplate('dsh-{slug}-{hash}', '/srv/projects/beta')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^dsh-alpha-[0-9a-f]{8}$/)
  assert.equal(normalizeWorkspacePath('/srv/projects/alpha/'), '/srv/projects/alpha')
  assert.equal(shortHash('/srv/projects/alpha').length, 8)
  assert.equal(slugify('中文 目录 Name!!'), 'name')
})

ok('routing: exact mapping > longest prefix > template', () => {
  const config = resolveConfig(
    {
      bank: {
        name_template: 'tmpl-{slug}',
        workspace_bank_mapping: {
          '/srv/projects': 'projects-bank',
          '/srv/projects/alpha': 'alpha-bank',
          '/data/shared': 'shared-bank'
        }
      }
    },
    { env: {} }
  ).config

  assert.equal(resolveBankId({ workspacePath: '/srv/projects/alpha', config }).rule, 'mapping-exact')
  assert.equal(resolveBankId({ workspacePath: '/srv/projects/alpha', config }).bankId, 'alpha-bank')

  const prefix = resolveBankId({ workspacePath: '/srv/projects/alpha/sub/dir', config })
  assert.equal(prefix.rule, 'mapping-prefix')
  assert.equal(prefix.bankId, 'alpha-bank', 'longest prefix wins')

  const projects = resolveBankId({ workspacePath: '/srv/projects/gamma', config })
  assert.equal(projects.bankId, 'projects-bank')

  const template = resolveBankId({ workspacePath: '/elsewhere/thing', config })
  assert.equal(template.rule, 'template:workspace')
  assert.match(template.bankId, /^tmpl-thing/)

  const legacy = resolveConfig({ bank: { default_bank: 'One Shared Bank', workspace_bank_mapping: { '/srv': 'x' } } }, { env: {} }).config
  const legacyRoute = resolveBankId({ workspacePath: '/srv/projects/alpha', config: legacy })
  assert.notEqual(legacyRoute.rule, 'default_bank', 'default_bank no longer routes')
  assert.equal(legacyRoute.bankId, 'x')

  const noPrefix = resolveConfig({ bank: { prefix_match: false, workspace_bank_mapping: { '/srv/projects': 'p' } } }, { env: {} }).config
  assert.equal(resolveBankId({ workspacePath: '/srv/projects/alpha', config: noPrefix }).rule, 'template:workspace')
})

ok('two workspaces can be forced into one bank (cross-workspace sharing)', () => {
  const config = resolveConfig(
    { bank: { workspace_bank_mapping: { '/srv/projects/alpha': 'team-memory', '/srv/projects/beta': 'team-memory' } } },
    { env: {} }
  ).config
  const a = resolveBankId({ workspacePath: '/srv/projects/alpha', config })
  const b = resolveBankId({ workspacePath: '/srv/projects/beta', config })
  assert.equal(a.bankId, b.bankId)
  assert.equal(a.bankId, 'team-memory')
})

// Precedence: defaults -> external JSON -> inline plugin config -> environment.
ok('external JSON is overridden by inline config, and env wins over both', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-config-'))
  try {
    const file = join(dir, 'memory.json')
    writeFileSync(
      file,
      JSON.stringify({ prune: { keep_recent_turns: 99 }, recall: { top_n: 42 }, bank: { default_bank: 'from-file' } })
    )
    const inline = { file, prune: { keep_recent_turns: 3 } }
    const { config } = resolveConfig(inline, { env: {} })
    assert.equal(config.prune.keep_recent_turns, 3, 'inline wins over the JSON file')
    assert.equal(config.recall.top_n, 42, 'file value survives when inline is silent')
    assert.equal(config.bank.default_bank, 'from-file')

    const withEnv = resolveConfig(inline, { env: { DSH_HINDSIGHT_RECALL_TOP_N: '7', DSH_HINDSIGHT_KEEP_RECENT_TURNS: '2' } }).config
    assert.equal(withEnv.recall.top_n, 7, 'env wins over the file')
    assert.equal(withEnv.prune.keep_recent_turns, 2, 'env wins over inline')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

ok('~ in retain.state_dir expands to an absolute path (never a literal "~" directory)', () => {
  const { config } = resolveConfig({ retain: { state_dir: '~/dsh-memory-state' } }, { env: {} })
  assert.equal(config.retain.state_dir.startsWith('/'), true, config.retain.state_dir)
  assert.equal(config.retain.state_dir.includes('~'), false)
  const disabled = resolveConfig({ retain: { state_dir: '' } }, { env: {} }).config
  assert.equal(disabled.retain.state_dir, '', 'empty disables persistence')
})

ok('unchanged DEFAULT_CONFIG after many resolutions (no shared-state pollution)', () => {
  assert.equal(DEFAULT_CONFIG.prune.keep_recent_turns, 6)
  assert.equal(DEFAULT_CONFIG.recall.max_tokens, 1200)
  assert.equal(DEFAULT_CONFIG.recall.cooldown_ms, 60000)
  assert.equal(DEFAULT_CONFIG.enabled, true)
})

console.log(`\n${passed} config/bank tests passed`)
