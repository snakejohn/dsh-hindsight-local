/**
 * Unit tests: hook wiring (recall injection, async retain, prune planning/execution)
 * driven through a fake Cordis context.
 * Run: node tests/test-hooks.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendTurn,
  buildRuntime,
  buildSession,
  createFakeAgent,
  createFakeClient,
  createFakeCtx,
  memoryResult
} from './harness.mjs'
import { apply } from '../index.js'
// apply() mirrors settings into <plugin root>/.env: keep tests out of the checkout.
process.env.DSH_HINDSIGHT_PLUGIN_ROOT ||= (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'hs-hooks-root-'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const TURNS = Array.from({ length: 14 }, (_v, index) => ({
  user: `问题 ${index}：请把这个仓库里的构建脚本说明清楚，并给出如何运行测试`,
  assistant: `回答 ${index}：构建脚本位于 build.mjs，测试入口是 npm test。`,
  tool: index === 3 ? { name: 'read', arguments: { path: 'build.mjs' } } : undefined
}))

// 1. pre-step injects a recalled memory block and keeps the admitted messages.
{
  const client = createFakeClient({ results: [memoryResult('该工作区的部署脚本是 deploy.sh', 0.91), memoryResult('line one', 0.5, 'experience')] })
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 2) })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => {} } } })
  runtime.attach(ctx)

  const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '我们之前用的部署脚本叫什么？' }], source: { kind: 'user' } }]
  const decision = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 1, step: 1 }, () => ({ kind: 'enter', messages: admitted }))

  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 2, 'original message + memory message')
  const injected = decision.messages[1]
  assert.equal(injected.source.kind, 'plugin:dsh-hindsight-memory')
  assert.equal(injected.source.form, 'recall')
  assert.match(injected.content[0].text, /<memory-context bank="/)
  assert.match(injected.content[0].text, /deploy\.sh/)
  assert.equal(client.calls.recall.length, 1)
  assert.match(client.calls.recall[0].body.query, /部署脚本/)
  assert.equal(client.calls.recall[0].body.budget, 'mid')
  assert.equal(client.calls.recall[0].bankId, runtime.workspaceFor(agent).bankId)
  console.log('PASS pre-step recalls and injects one memory message')
}

// 2. same turn is never recalled twice; short prompts are skipped.
{
  const client = createFakeClient({ results: [memoryResult('x'.repeat(30), 0.9)] })
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 2) })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => {} } } })
  runtime.attach(ctx)
  const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '项目结构是怎样的，请详细说明一下' }], source: { kind: 'user' } }]

  await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 2, step: 1 }, () => ({ kind: 'enter', messages: admitted }))
  await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 2, step: 2 }, () => ({ kind: 'enter', messages: admitted }))
  assert.equal(client.calls.recall.length, 1, 'second step of the same turn reuses the result')

  const short = [{ id: 'u2', role: 'user', content: [{ type: 'text', text: 'ok' }], source: { kind: 'user' } }]
  const decision = await ctx.waterfall('agent/pre-step', { agent, messages: short, turn: 3, step: 1 }, () => ({ kind: 'enter', messages: short }))
  assert.equal(decision.messages.length, 1)
  assert.equal(client.calls.recall.length, 1, 'short prompt skipped')
  console.log('PASS recall is per-turn and skips trivial prompts')
}

// 3. recall outage: no injection, one warning, cooldown, conversation unaffected.
{
  const failure = Object.assign(new Error('HTTP 500 recall -> Failed to generate batch embeddings: 429'), { status: 500 })
  const client = createFakeClient({ failRecall: failure })
  const { runtime, logger } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 2) })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => {} } } })
  runtime.attach(ctx)
  const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '解释一下这个模块的设计取舍' }], source: { kind: 'user' } }]

  const first = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 1, step: 1 }, () => ({ kind: 'enter', messages: admitted }))
  assert.equal(first.messages.length, 1, 'no injection on failure')
  assert.equal(runtime.stats.recallsFailed, 1)

  const second = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 2, step: 1 }, () => ({ kind: 'enter', messages: admitted }))
  assert.equal(second.messages.length, 1)
  assert.equal(client.calls.recall.length, 1, 'cooldown suppresses further recall attempts')
  console.log('PASS recall failure degrades silently and enters a cooldown')
}

// 4. subagent sessions are ignored entirely.
{
  const client = createFakeClient({ results: [memoryResult('unused', 0.9)] })
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 1) })
  session.header.origin = 'subagent'
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({})
  runtime.attach(ctx)
  const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '子代理的一个很长很长的问题描述' }], source: { kind: 'user' } }]
  const decision = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 1, step: 1 }, () => ({ kind: 'enter', messages: admitted }))
  assert.equal(decision.messages.length, 1)
  assert.equal(client.calls.recall.length, 0)
  console.log('PASS subagent sessions are skipped')
}

// 5. turn-stopping retains only new turns, asynchronously, with bank routing metadata.
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: '', include_tool_calls: true } } })
  const session = buildSession({ turns: TURNS.slice(0, 4) })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => {} } } })
  runtime.attach(ctx)

  ctx.emit('agent/turn-stopping', { agent, turn: 4 })
  assert.equal(client.calls.retain.length, 0, 'retain must not run on the hook thread')
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1)
  const [call] = client.calls.retain
  assert.equal(call.items.length, 4)
  assert.equal(call.options.async, true)
  assert.match(call.items[0].content, /USER（用户本人）: 问题 0/)
  assert.match(call.items[0].content, /ASSISTANT: 回答 0/)
  assert.match(call.items[3].content, /\[tool read\]/, 'tool call is retained for turn 3 when 工具调用内容 is on')
  assert.equal(call.items[0].metadata.harness, 'dsh')
  assert.ok(call.items[0].tags.includes('dsh'))
  assert.equal(call.bankId, runtime.workspaceFor(agent).bankId)

  // Same history again: nothing new to send.
  ctx.emit('agent/turn-stopping', { agent, turn: 3 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1, 'no duplicate retain')

  // A fifth turn arrives: only that one is sent.
  appendTurn(session, TURNS[4])
  ctx.emit('agent/turn-stopping', { agent, turn: 5 })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 2)
  assert.equal(client.calls.retain[1].items.length, 1, 'only the new turn is retained')
  assert.match(client.calls.retain[1].items[0].content, /问题 4/)
  console.log('PASS turn-stopping retains new turns only, off the critical path')
}

// 6. retain failure is swallowed and counted.
{
  const client = createFakeClient({ failRetain: Object.assign(new Error('HTTP 400 bad request'), { status: 400 }) })
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 2) })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({})
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 2 })
  await runtime.flush()
  assert.equal(runtime.stats.retainsFailed, 1)
  console.log('PASS retain failure is logged and swallowed')
}

// 7. prune: planned on turn-stopping, executed once the agent goes idle.
{
  const client = createFakeClient()
  const { runtime, config } = buildRuntime({
    fakeClient: client,
    rawConfig: { prune: { enabled: true, keep_recent_turns: 4, trigger_after_turns: 6, min_prune_turns: 2 } }
  })
  const session = buildSession({ turns: TURNS })
  const agent = createFakeAgent({ session, status: 'running' })
  const regions = []
  const compaction = {
    async compactRegion(start, end, contextArgs, signal) {
      regions.push({ start, end, session: contextArgs.session })
      assert.ok(signal, 'compaction receives the abort signal')
    }
  }
  const ctx = createFakeCtx({ services: { compaction } })
  runtime.attach(ctx)
  assert.equal(runtime.compaction, compaction, 'compaction engine bound through ctx.inject')

  ctx.emit('agent/turn-stopping', { agent, turn: TURNS.length })
  assert.equal(regions.length, 0, 'prune must not run inside the hook')
  assert.equal(runtime.sessionState(agent).pendingPrune, true)

  ctx.emit('agent/status', { agent, status: 'idle' })
  await wait(600)
  assert.equal(regions.length, 1)
  // 14 user turns, keep 4 -> the range starts at the first human turn (never the system
  // node) and ends immediately before the first kept user turn.
  const userNodeIndexes = session.surface.nodes
    .map((seq, index) => (session.eventAt(seq).type === 'user/message' ? index : -1))
    .filter((index) => index >= 0)
  const expectedStart = session.surface.nodes[userNodeIndexes[0]]
  const expectedEnd = session.surface.nodes[userNodeIndexes[userNodeIndexes.length - 4] - 1]
  assert.equal(regions[0].end, expectedEnd, 'cut lands immediately before the first kept user turn')
  assert.equal(regions[0].start, expectedStart, 'range starts at the first human turn, not the system node')
  assert.equal(regions[0].session, session)
  assert.equal(runtime.stats.prunes, 1)
  assert.equal(runtime.sessionState(agent).lastPrunedEndSeq, expectedEnd)

  // Second idle pass must not prune the same region again.
  ctx.emit('agent/turn-stopping', { agent, turn: TURNS.length + 1 })
  ctx.emit('agent/status', { agent, status: 'idle' })
  await wait(600)
  assert.equal(regions.length, 1, 'already-pruned region is not re-summarised')
  assert.match(runtime.sessionState(agent).lastPruneReason, /already-pruned|below-trigger/)
  console.log('PASS prune folds old turns through compactRegion, exactly once')
}

// 8. prune stays off when below the trigger, and when no compaction engine exists.
{
  const { runtime } = buildRuntime({
    fakeClient: createFakeClient(),
    rawConfig: { prune: { enabled: true, keep_recent_turns: 4, trigger_after_turns: 10, min_prune_turns: 2 } }
  })
  const session = buildSession({ turns: TURNS.slice(0, 5) })
  const agent = createFakeAgent({ session })
  let calls = 0
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => { calls += 1 } } } })
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 5 })
  ctx.emit('agent/status', { agent, status: 'idle' })
  await wait(400)
  assert.match(runtime.sessionState(agent).lastPruneReason, /below-trigger/)
  assert.equal(calls, 0)
  assert.equal(runtime.stats.prunes, 0)

  const bare = buildRuntime({ fakeClient: createFakeClient() })
  const bareCtx = createFakeCtx({})
  const bareAgent = createFakeAgent({ session: buildSession({ turns: TURNS }) })
  bare.runtime.attach(bareCtx)
  bareCtx.emit('agent/turn-stopping', { agent: bareAgent, turn: TURNS.length })
  bareCtx.emit('agent/status', { agent: bareAgent, status: 'idle' })
  await wait(300)
  assert.equal(bare.runtime.compaction, null)
  assert.equal(bare.runtime.stats.prunes, 0, 'no compaction engine => no prune')
  console.log('PASS prune respects the turn trigger and missing compaction')
}

// 9. compaction failure never escapes.
{
  const { runtime } = buildRuntime({
    fakeClient: createFakeClient(),
    rawConfig: { prune: { enabled: true, keep_recent_turns: 3, trigger_after_turns: 4 } }
  })
  const session = buildSession({ turns: TURNS })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({
    services: {
      compaction: {
        async compactRegion() {
          throw new Error('tool pairing unbalanced')
        }
      }
    }
  })
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: TURNS.length })
  ctx.emit('agent/status', { agent, status: 'idle' })
  await wait(600)
  assert.equal(runtime.stats.prunesFailed, 1)
  assert.equal(runtime.sessionState(agent).lastPrunedEndSeq, 0)
  console.log('PASS compaction errors are contained')
}

// 10. factory: apply() wires hooks, boots without blocking and shuts down cleanly.
{
  const server = await startStubServer()
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => {} } } })
  const rawConfig = {
    service: { mode: 'attach', base_url: server.url, autostart: false, health_timeout_ms: 1000, request_timeout_ms: 2000 },
    logging: { level: 'debug' }
  }
  const handle = apply(ctx, rawConfig)
  assert.equal(ctx.has('agent/pre-step'), true)
  assert.equal(ctx.has('agent/turn-stopping'), true)
  assert.equal(ctx.has('agent/status'), true)
  assert.equal(ctx.has('agent/disposed'), true)
  await wait(400)
  assert.equal(handle.runtime.service.state, 'ready')
  await ctx.dispose()
  assert.equal(handle.runtime.service.state, 'stopped')
  await server.close()
  console.log('PASS apply() wires all hooks, boots in the background and shuts down on dispose')
}

async function startStubServer() {
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'healthy' }))
      return
    }
    if (req.url === '/version') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ api_version: '1.1.0-stub' }))
      return
    }
    res.writeHead(404).end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

// 11. plugin-injected context never re-enters the memory store (no feedback loop).
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 2), injectedBefore: '<memory-context bank="x">old memory</memory-context>' })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({})
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 2 })
  await runtime.flush()
  const contents = client.calls.retain[0].items.map((item) => item.content).join('\n')
  assert.equal(contents.includes('memory-context'), false, 'injected recall must not be retained')
  assert.equal(client.calls.retain[0].items.length, 2)
  console.log('PASS injected recall context is excluded from retention')
}

// 12. prune never swallows a system-prompt node, and ignores plugin context nodes.
{
  const { runtime } = buildRuntime({
    fakeClient: createFakeClient(),
    rawConfig: { prune: { enabled: true, keep_recent_turns: 3, trigger_after_turns: 4 } }
  })
  const session = buildSession({ turns: TURNS.slice(0, 8), injectedBefore: 'context blurb' })
  const agent = createFakeAgent({ session })
  const regions = []
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async (start, end) => regions.push({ start, end }) } } })
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 8 })
  ctx.emit('agent/status', { agent, status: 'idle' })
  await wait(500)
  assert.equal(regions.length, 1)
  const systemSeq = session.surface.nodes[0]
  assert.ok(regions[0].start > systemSeq, 'system node stays outside the pruned region')
  const kinds = session.surface.nodes.map((seq) => runtime.classifyNode(session, seq))
  assert.equal(kinds[0], 'system')
  assert.equal(kinds[1], 'context')
  assert.equal(kinds[2], 'user')
  console.log('PASS prune range excludes the system prompt and plugin context nodes')
}

// 13. An upstream pre-step listener that throws must not break the turn.
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 2) })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({})
  runtime.attach(ctx)
  // A second, lower-priority listener that explodes.
  ctx.on('agent/pre-step', () => {
    throw new Error('upstream plugin blew up')
  })
  const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '部署脚本的参数怎么传？' }], source: { kind: 'user' } }]
  const decision = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 1, step: 1 }, () => ({
    kind: 'enter',
    messages: admitted
  }))
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1, 'the admitted batch survives the upstream failure')
  assert.equal(client.calls.retain.length + client.calls.recall.length, 0, 'no memory work after an upstream failure')
  console.log('PASS upstream pre-step failure degrades to a plain enter')
}

// 14. enabled:false is a real kill switch.
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { enabled: false } })
  const session = buildSession({ turns: TURNS.slice(0, 4) })
  const agent = createFakeAgent({ session })
  const ctx = createFakeCtx({ services: { compaction: { compactRegion: async () => assert.fail('must not prune') } } })
  runtime.attach(ctx)
  assert.equal(await runtime.boot('startup'), false, 'disabled plugin never boots the service')
  ctx.emit('agent/turn-stopping', { agent, turn: 4 })
  ctx.emit('agent/status', { agent, status: 'idle' })
  const admitted = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '部署脚本的参数怎么传？' }], source: { kind: 'user' } }]
  const decision = await ctx.waterfall('agent/pre-step', { agent, messages: admitted, turn: 1, step: 1 }, () => ({
    kind: 'enter',
    messages: admitted
  }))
  assert.equal(decision.messages.length, 1)
  await runtime.flush()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(client.calls.retain.length, 0, 'no data leaves the process when disabled')
  assert.equal(client.calls.recall.length, 0, 'no recall when disabled')
  assert.equal(client.calls.ensureBank.length, 0, 'no bank is created when disabled')
  console.log('PASS enabled:false suppresses boot, recall, retain and prune')
}

// 15. The warm-up hook is the real event name.
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client })
  const ctx = createFakeCtx({})
  runtime.attach(ctx)
  assert.equal(ctx.has('agent/created'), true, 'agent/created is the real session-start hook')
  assert.equal(ctx.has('agent/session-start'), false, 'agent/session-start does not exist in DSH')
  const session = buildSession({ turns: TURNS.slice(0, 1) })
  const agent = createFakeAgent({ session })
  await ctx.serial('agent/created', { agent, source: 'startup' })
  assert.equal(client.calls.ensureBank.length, 1)
  // A throwing listener must never fail creation: the hook is serial in DSH.
  const odd = createFakeAgent({ session: buildSession({ turns: [], cwd: null, id: 'session-odd' }) })
  odd.session.header = null
  await ctx.serial('agent/created', { agent: odd, source: 'startup' })
  console.log('PASS agent/created warms the bank and swallows its own errors')
}

// 16. Disposing a session drops its pending prune timer instead of leaking state.
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { prune: { enabled: true } } })
  const session = buildSession({ turns: TURNS.slice(0, 14) })
  const agent = createFakeAgent({ session })
  const compacted = []
  const ctx = createFakeCtx({
    services: {
      compaction: {
        async compactRegion(startSeq, endSeq) {
          compacted.push([startSeq, endSeq])
        }
      }
    }
  })
  runtime.attach(ctx)
  ctx.emit('agent/turn-stopping', { agent, turn: 14 })
  ctx.emit('agent/status', { agent, status: 'idle' })
  const state = runtime.sessions.get(session.header.id)
  assert.ok(state?.pruneTimer, 'a prune timer is scheduled while idle')
  ctx.emit('agent/disposed', { agent })
  assert.equal(runtime.sessions.size, 0, 'session state is released')
  assert.equal(state.pruneTimer, null, 'the timer handle is cleared')
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.equal(runtime.sessions.size, 0, 'a fired timer must not resurrect the session state')
  assert.equal(compacted.length, 0, 'no prune runs against a disposed agent')
  console.log('PASS dispose clears the prune timer and never resurrects session state')
}

// 17. Two turn-stopping hooks in a row produce exactly one retain.
{
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client })
  const session = buildSession({ turns: TURNS.slice(0, 4) })
  const agent = createFakeAgent({ session })
  runtime.attach(createFakeCtx({}))
  runtime.onTurnStopping({ agent })
  runtime.onTurnStopping({ agent })
  runtime.onTurnStopping({ agent })
  await runtime.flush()
  assert.equal(client.calls.retain.length, 1, 'concurrent hooks share one flight')
  assert.equal(client.calls.retain[0].items.length, 4)
  console.log('PASS concurrent turn-stopping calls collapse into one retain')
}

// 18. The retain cursor is persisted, so a resumed session does not re-send its history.
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-cursor-'))
  try {
    const session = buildSession({ turns: TURNS.slice(0, 3), id: 'session-resumable' })
    const first = createFakeClient()
    const firstRuntime = buildRuntime({ fakeClient: first, rawConfig: { retain: { state_dir: dir } } }).runtime
    firstRuntime.attach(createFakeCtx({}))
    firstRuntime.scheduleRetain(createFakeAgent({ session }))
    await firstRuntime.flush()
    assert.equal(first.calls.retain.length, 1)

    // Fresh process, same session id and same log (a resume).
    const resumed = createFakeClient()
    const resumedRuntime = buildRuntime({ fakeClient: resumed, rawConfig: { retain: { state_dir: dir } } }).runtime
    resumedRuntime.attach(createFakeCtx({}))
    const state = resumedRuntime.sessionState(createFakeAgent({ session }))
    assert.ok(state.retainedSeq > 0, 'cursor restored from disk')
    resumedRuntime.scheduleRetain(createFakeAgent({ session }))
    await resumedRuntime.flush()
    assert.equal(resumed.calls.retain.length, 0, 'nothing is re-retained after a resume')
    console.log('PASS retain cursor persists across runtimes (no duplicate history on resume)')
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

// 19. A tool-result surface node must never be the cut point of a prune region.
{
  const { planPrune } = await import('../lib/prune.js')
  const log = [
    { type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'u1' }], source: { kind: 'user' } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'a1' }] } } },
    { type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'a1b' }] } } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'u2' }], source: { kind: 'user' } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } } }
  ]
  const session = {
    log,
    surface: { nodes: [1, 2, 3, 4, 5, 6, 7] },
    eventAt: (seq) => log[seq - 1],
    snapshotEvents: () => [...log],
    deriveMessages: () => []
  }
  const kindOf = (seq) => {
    const type = log[seq - 1].type
    if (type === 'system/message') return 'system'
    if (type === 'tool/result' || type === 'tool/call') return 'tool'
    if (type === 'user/message') return 'user'
    return 'other'
  }
  const nodeKinds = session.surface.nodes.map(kindOf)
  const plan = planPrune({
    nodes: session.surface.nodes,
    nodeKinds,
    config: { enabled: true, prune: { enabled: true, mode: 'auto', keep_recent_turns: 1, trigger_after_turns: 2, min_prune_turns: 1 } },
    lastPrunedEndSeq: 0
  })
  assert.equal(plan.reason, 'ok', JSON.stringify(plan))
  assert.equal(kindOf(plan.plan.endSeq), 'other', 'the cut sits on an assistant message, not a tool node')
  assert.ok(plan.plan.endSeq < 6, 'the kept window starts at the last human turn')
  console.log('PASS prune never cuts on a tool surface node')
}

console.log('\nhook tests passed')
