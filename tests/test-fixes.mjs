/** Regression tests for the review fixes (bank scope, numeric time, steering, prune agent, docker). */
import assert from 'node:assert/strict'
import { resolveBankId } from '../lib/bank.js'
import { resolveConfig, serviceEnv } from '../lib/config.js'
import { planPrune, executePrune } from '../lib/prune.js'
import { buildRuntime, buildSession, appendTurn, createFakeAgent, createFakeClient, createFakeCtx } from './harness.mjs'

const cfg = (bank) => ({ bank: { template: 'dsh-{slug}-{hash}', ...bank } })
// 1. banks are per workspace only: preset/session never split a workspace
{
  const w = '/home/u/rp'
  const a = resolveBankId({ workspacePath: w, config: cfg({ scope: 'preset' }), preset: 'alice' })
  const b = resolveBankId({ workspacePath: w, config: cfg({ scope: 'session' }), sessionId: 's1' })
  const ws = resolveBankId({ workspacePath: w, config: cfg({}) })
  assert.equal(a.bankId, ws.bankId); assert.equal(b.bankId, ws.bankId)
  assert.equal(ws.rule, 'template:workspace')
  console.log('PASS bank resolves by workspace only', ws.bankId)
}
// 2. provider-aware env
{
  const { config: c } = resolveConfig({ embedding: { provider: 'local', model: 'BAAI/bge-m3' }, reranker: { provider: 'siliconflow', model: 'BAAI/bge-reranker-v2-m3', api_key: 'x', base_url: 'https://api.siliconflow.cn/v1' }, llm: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'k' } }, { env: {} })
  const env = serviceEnv(c)
  assert.equal(env.HINDSIGHT_API_EMBEDDINGS_PROVIDER, 'local')
  assert.equal(env.HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL, 'BAAI/bge-m3')
  assert.equal(env.HINDSIGHT_API_RERANKER_SILICONFLOW_MODEL, 'BAAI/bge-reranker-v2-m3')
  assert.ok(!('HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL' in env))
  const off = serviceEnv(resolveConfig({ reranker: { enabled: false } }, { env: {} }).config)
  assert.equal(off.HINDSIGHT_API_ENABLE_RERANKING, 'false')
  console.log('PASS serviceEnv maps local/siliconflow/deepseek and reranker.enabled')
}
// 3. numeric event time (real dsh) -> ISO timestamp; steering continuation is re-sent
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: [{ user: '问题 A 关于城堡', assistant: '回答 A 很长的一段关于城堡的描述' }] })
  for (const e of session.log) e.time = Date.parse('2026-10-23T10:00:00Z')
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: {} })
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 1 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1)
  const first = client.calls.retain[0].items.at(-1)
  assert.equal(Date.parse(first.timestamp), Date.parse('2026-10-23T10:00:00Z')); assert.match(first.timestamp, /[+-]\d\d:\d\d$/)
  // nothing new -> no re-send
  ctx.emit('agent/turn-stopping', { agent, turn: 1 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1, 'completed turn is not re-extracted')
  // steering: more assistant output in the same turn
  const msg = { role: 'assistant', content: [{ type: 'text', text: '续写：骑士进入城堡' }] }
  session.log.push({ type: 'assistant/message', time: Date.now(), data: { turn: 1, step: 2, message: msg } })
  ctx.emit('agent/turn-stopping', { agent, turn: 1 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 2)
  const again = client.calls.retain[1].items
  assert.equal(again.length, 1)
  assert.equal(again[0].document_id, first.document_id, 'same document_id => Hindsight replaces')
  assert.match(again[0].content, /续写/)
  console.log('PASS numeric time + steering continuation re-sent under same document_id')
}
// 4. prune passes the real agent to compactRegion
{
  let got
  const session = buildSession({ turns: Array.from({ length: 8 }, (_, i) => ({ user: `q${i}`, assistant: `a${i}` })) })
  const agent = createFakeAgent({ session })
  const { config } = resolveConfig({ prune: { enabled: true, keep_recent_turns: 2, trigger_after_turns: 3, min_prune_turns: 1 } }, { env: {} })
  const plan = { startSeq: 2, endSeq: 6, droppedTurns: 2, keptTurns: 2 }
  void config; void planPrune
  if (plan) {
    await executePrune({ agent, plan, compaction: { compactRegion: async (s, e, a, sig) => { got = a; assert.ok(sig) } } })
    assert.equal(got, agent)
    console.log('PASS compactRegion receives the Agent')
  } else console.log('SKIP prune plan signature differs')
}
// 5. backfill historical sessions via sessionPersistence, with dedupe across runs
{
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { backfillSessions } = await import('../lib/backfill.js')
  const stateDir = mkdtempSync(join(tmpdir(), 'hs-bf-'))
  const mk = (id, preset) => {
    const s = buildSession({ id, turns: [{ user: `${id} 第一幕：骑士出发去城堡`, assistant: '旁白：夜色中骑士骑马穿过森林' }, { user: '第二幕开始，骑士抵达城门前', assistant: '旁白：城门缓缓打开，守卫举着火把盘问骑士的来意' }] })
    s.header.agentPreset = preset
    return s
  }
  const stored = [mk('old-1', 'alice'), mk('old-2', 'bob'), { ...mk('sub-1', 'x'), header: { id: 'sub-1', origin: 'subagent' } }]
  const persistence = {
    list: async () => stored.map((s) => ({ header: s.header })),
    open: async (id) => ({ read: async () => ({ events: stored.find((s) => s.header.id === id).log.map((e) => e) }), close: async () => {} })
  }
  for (const s of stored) s.log.forEach((e) => {}) // harness events are 1-based in eventAt only; read() is 0-based like real handle
  const run = async () => {
    const client = createFakeClient()
    const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: stateDir } } })
    const sum = await backfillSessions({ runtime, persistence, config: runtime.config, logger: { info() {}, warn: console.warn } })
    await runtime.flush()
    return { client, sum, runtime }
  }
  const r1 = await run()
  assert.equal(r1.sum.scanned, 2)
  assert.equal(r1.sum.skipped, 1, 'subagent skipped')
  const banks = new Set(r1.client.calls.retain.map((c) => c.bankId))
  assert.equal(r1.client.calls.retain.length, 2)
  const sent1 = r1.client.calls.retain.flatMap((c) => c.items).length
  const r2 = await run()
  assert.equal(r2.client.calls.retain.length, 0, 'second backfill sends nothing (cursor files)')
  console.log(`PASS backfill: 2 sessions, ${sent1} turns, ${banks.size} bank(s); rerun dedup ok`)
}
// 6. catch-up: turn stopped while backend down is flushed once it becomes ready
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { catchup_poll_ms: 1000 } }, serviceOverrides: {} })
  let ready = false
  Object.defineProperty(runtime.service, 'ready', { get: () => ready, configurable: true })
  runtime.waitReady = async () => ready
  const session = buildSession({ id: 'late-1', turns: [{ user: '启动时说的第一句话很重要', assistant: '好的，我记住了这件很重要的事情' }] })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: {} })
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 1 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 0)
  ready = true
  await new Promise((r) => setTimeout(r, 2300))
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1, 'catch-up retained the early turn')
  await runtime.shutdown()
  console.log('PASS catch-up after late Hindsight readiness')
}
