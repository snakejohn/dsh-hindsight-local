/**
 * Manual self-check: run against a live Hindsight server and print what the plugin sees.
 * Usage:
 *   node scripts/selftest.mjs
 *   node scripts/selftest.mjs --base-url http://127.0.0.1:8888 --workspace /srv/app
 *   node scripts/selftest.mjs --config /path/to/config.json
 * Writes one throwaway bank named `dsh-selftest-<hash>`; nothing else is touched.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HindsightClient } from '../lib/client.js'
import { resolveConfig } from '../lib/config.js'
import { resolveBankId } from '../lib/bank.js'
import { shortHash } from '../lib/bank.js'

const args = process.argv.slice(2)
const argValue = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const configFile = argValue('config', '')
const inline = configFile ? JSON.parse(readFileSync(resolve(configFile), 'utf8')) : {}
if (argValue('base-url')) inline.service = { ...(inline.service || {}), base_url: argValue('base-url') }
const workspace = resolve(argValue('workspace', process.cwd()))

const { config, warnings } = resolveConfig(inline, { cwd: workspace })
for (const warning of warnings) console.log(`WARN ${warning}`)

const redact = (value) => (value ? `${String(value).slice(0, 4)}***${String(value).slice(-2)}` : '(empty)')
console.log('config:')
console.log(`  service.base_url      ${config.service.base_url}`)
console.log(`  service.mode          ${config.service.mode} (autostart=${config.service.autostart})`)
console.log(`  embedding             provider=${config.embedding.provider || '-'} model=${config.embedding.model || '-'} dims=${config.embedding.dimensions || '-'} key=${redact(config.embedding.api_key)}`)
console.log(`  reranker              provider=${config.reranker.provider || '-'} model=${config.reranker.model || '-'} top_n=${config.reranker.top_n} threshold=${config.reranker.score_threshold}`)
console.log(`  llm                   provider=${config.llm.provider || '-'} model=${config.llm.model || '-'} temp=${config.llm.temperature} max_tokens=${config.llm.max_tokens}`)
console.log(`  recall                budget=${config.recall.budget} max_tokens=${config.recall.max_tokens} top_n=${config.recall.top_n}`)
console.log(`  retain                async=${config.retain.async} batch=${config.retain.max_turns_per_batch}`)
console.log(`  prune                 keep_recent_turns=${config.prune.keep_recent_turns} trigger_after_turns=${config.prune.trigger_after_turns}`)

const route = resolveBankId({ workspacePath: workspace, config })
console.log(`\nbank routing for ${workspace}\n  -> ${route.bankId} (rule=${route.rule}${route.matchedKey ? `, matched=${route.matchedKey}` : ''})`)

const client = new HindsightClient({
  baseUrl: config.service.base_url,
  apiPrefix: config.service.api_prefix,
  apiKey: config.service.api_key,
  timeoutMs: config.service.request_timeout_ms
})

const health = await client.health({ timeoutMs: 3000 })
console.log(`\nhealth: ${health.ok ? 'OK' : 'FAIL'} (${health.ok ? JSON.stringify(health.body?.status ?? health.body) : health.error})`)
if (!health.ok) {
  console.log('the plugin would log one warning and continue with native DSH context (no memory).')
  process.exit(0)
}

const version = await client.version()
console.log(`version: api_version=${version.api_version || '?'} features=${Object.keys(version.features || {}).join(',')}`)

const bankId = `dsh-selftest-${shortHash(workspace)}`
await client.ensureBank(bankId, { mission: config.bank.mission, background: config.bank.background })
console.log(`bank: ${bankId} ready`)

const marker = `selftest ${new Date().toISOString()}`
const retained = await client.retain(
  bankId,
  [
    {
      content: `USER: ${marker} —— 这个工作区的部署脚本是 deploy.sh，参数 --workspace。\nASSISTANT: 已记录。`,
      context: 'dsh-memory selftest',
      document_id: `${bankId}:${Date.now()}`,
      tags: ['dsh', 'selftest'],
      metadata: { harness: 'dsh', kind: 'selftest' }
    }
  ],
  { async: config.retain.async }
)
console.log(`retain: ${JSON.stringify({ success: retained.success, items: retained.items_count, async: retained.async })}`)

try {
  const recalled = await client.recall(bankId, { query: '部署脚本 deploy.sh 参数', budget: config.recall.budget, max_tokens: config.recall.max_tokens })
  const results = recalled.results || []
  console.log(`recall: ${results.length} result(s)`)
  for (const result of results.slice(0, 3)) {
    console.log(`  - [${result.type || 'mem'}] ${String(result.text).slice(0, 100)}`)
  }
  if (!results.length) console.log('  (empty: server-side extraction/embedding may still be queued)')
} catch (error) {
  console.log(`recall: FAILED -> ${error.message.slice(0, 200)}`)
  console.log('  the plugin treats this as an outage: no injection, 60s cooldown, conversation unaffected.')
}

console.log('\nselftest done')
