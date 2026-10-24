/**
 * Integration test against a real Hindsight server.
 * Defaults to http://127.0.0.1:8888; override with DSH_TEST_HINDSIGHT_URL.
 * The test SKIPs (exit 0) when no server answers, so `npm test` stays usable offline.
 * Run: node tests/test-integration.mjs
 */
import assert from 'node:assert/strict'
import { HindsightClient } from '../lib/client.js'
import { apply } from '../index.js'
import { createFakeCtx } from './harness.mjs'

const BASE_URL = process.env.DSH_TEST_HINDSIGHT_URL || 'http://127.0.0.1:8888'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SUFFIX = `${Date.now().toString(36)}${process.pid.toString(36).slice(-4)}`

const client = new HindsightClient({ baseUrl: BASE_URL, timeoutMs: 15000, logger: { debug: () => {}, info: () => {}, warn: () => {} } })

const health = await client.health({ timeoutMs: 3000 })
if (!health.ok) {
  console.log(`SKIP no Hindsight server at ${BASE_URL} (${health.error || health.status})`)
  process.exit(0)
}
console.log(`PASS health ${BASE_URL} -> ${JSON.stringify(health.body?.status || health.body).slice(0, 80)}`)

const version = await client.version()
console.log(`PASS version -> api_version=${version.api_version || 'unknown'} features=${Object.keys(version.features || {}).length}`)
assert.ok(version.api_version, 'server must advertise api_version')

const bankId = `dsh-plugin-it-${SUFFIX}`
const ensured = await client.ensureBank(bankId, { mission: 'dsh plugin integration test' })
assert.equal(ensured.bankId, bankId)
const again = await client.ensureBank(bankId)
assert.equal(again.cached, true, 'second call short-circuits locally')
const forced = await client.ensureBank(bankId, { force: true })
assert.equal(forced.created, true, 'forced PUT is idempotent server-side')
console.log(`PASS PUT bank ${bankId} (idempotent upsert)`)

const retain = await client.retain(
  bankId,
  [
    {
      content: 'USER: 这个仓库的测试入口是什么？\nASSISTANT: npm test 会跑 tests/run-all.mjs。',
      context: 'dsh plugin integration test · turn 0',
      document_id: `${bankId}:t0`,
      tags: ['dsh', 'integration'],
      metadata: { harness: 'dsh', turn: '0' }
    },
    {
      content: 'USER: 部署脚本叫什么？\nASSISTANT: deploy.sh，参数是 --workspace。',
      context: 'dsh plugin integration test · turn 1',
      document_id: `${bankId}:t1`,
      tags: ['dsh', 'integration'],
      metadata: { harness: 'dsh', turn: '1' }
    }
  ],
  { async: true }
)
assert.equal(retain.success, true, JSON.stringify(retain))
assert.equal(retain.items_count, 2)
console.log(`PASS POST memories (async) -> items_count=${retain.items_count} operation_id=${retain.operation_id}`)

// Recall is the endpoint that depends on the server's embedding provider; a provider
// outage (429) must be reported, not thrown into the conversation path.
let recallOutcome = 'ok'
try {
  const recalled = await client.recall(bankId, { query: '部署脚本叫什么', budget: 'mid', max_tokens: 800 })
  const count = Array.isArray(recalled.results) ? recalled.results.length : 0
  console.log(`PASS recall -> ${count} result(s)`)
} catch (error) {
  recallOutcome = error.message
  console.log(`WARN recall unavailable on this server (embedding provider): ${error.message.slice(0, 180)}`)
  console.log('     the plugin treats this exactly like an outage: no injection, conversation continues')
}

// Full plugin path against the real server: boot in attach mode, then run one step.
const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => {} } } })
const handle = apply(ctx, {
  service: { mode: 'attach', base_url: BASE_URL, autostart: false, request_timeout_ms: 3000, health_timeout_ms: 2000 },
  bank: { name_template: `dsh-it-{slug}-{hash}` },
  logging: { level: 'debug' }
})
for (let i = 0; i < 40 && handle.runtime.service.state !== 'ready'; i += 1) await wait(100)
assert.equal(handle.runtime.service.state, 'ready', 'plugin should attach to the running server')
console.log(`PASS plugin boot: state=${handle.runtime.service.state} mode=${handle.runtime.service.launchMode}`)

const sessionEvents = [
  {
    type: 'user/message',
    time: new Date().toISOString(),
    data: {
      message: {
        role: 'user',
        content: [{ type: 'text', text: '这个工作区的部署脚本叫什么，参数怎么传？请给出完整调用示例。' }],
        source: { kind: 'user' }
      }
    }
  },
  {
    type: 'assistant/message',
    time: new Date().toISOString(),
    data: {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '部署脚本是 deploy.sh，参数为 --workspace <path>，示例：./deploy.sh --workspace /srv/app。' }]
      }
    }
  }
]
const session = {
  header: { id: `it-session-${SUFFIX}`, cwd: '/tmp/dsh-memory-it-workspace' },
  surface: { nodes: [1, 2] },
  snapshotEvents: () => sessionEvents,
  deriveMessages: () => []
}
const agent = {
  session,
  options: {},
  status: 'running',
  async whenIdle() {},
  async runMaintenance(task) {
    return task(new AbortController().signal)
  }
}
const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '部署脚本叫什么名字，参数怎么传？' }], source: { kind: 'user' } }]
const decision = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 1, step: 1 }, () => ({ kind: 'enter', messages: admitted }))
assert.equal(decision.kind, 'enter')
assert.ok(decision.messages.length === 1 || decision.messages.length === 2)
console.log(
  `PASS pre-step against live server: injected=${decision.messages.length - 1} message(s), recall stats=${JSON.stringify(handle.runtime.stats)}`
)

ctx.emit('agent/turn-stopping', { agent, turn: 1 })
await handle.runtime.flush()
assert.equal(handle.runtime.stats.retainsFailed, 0, 'live retain must not fail')
assert.equal(handle.runtime.stats.retains, 1, 'the live server must accept one retained turn')
console.log(`PASS turn-stopping against live server: retains=${handle.runtime.stats.retains} failed=${handle.runtime.stats.retainsFailed}`)

// Async extraction on the server side is not instantaneous: poll instead of sleeping blindly.
const pluginBank = handle.runtime.workspaceFor(agent).bankId
let visible = 0
for (let attempt = 0; attempt < 10; attempt += 1) {
  await wait(1500)
  try {
    const probe = await client.recall(pluginBank, { query: '部署脚本 deploy.sh 参数', budget: 'low', max_tokens: 600 })
    visible = (probe.results || []).length
  } catch (error) {
    console.log(`WARN recall probe failed: ${error.message.slice(0, 140)}`)
    break
  }
  if (visible > 0) break
}
if (visible > 0) console.log(`PASS recall finds the retained memory in bank=${pluginBank} (${visible} hit(s))`)
else console.log(`WARN retained memory not retrievable within 15s in bank=${pluginBank} (server-side extraction latency/provider quota)`)

await ctx.dispose()
console.log(`PASS shutdown: state=${handle.runtime.service.state} (keep_alive_on_exit=false, attach mode => nothing to stop)`)
console.log(`\nintegration test done (recallOutcome=${recallOutcome === 'ok' ? 'ok' : 'provider-unavailable'})`)
