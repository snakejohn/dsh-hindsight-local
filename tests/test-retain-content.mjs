// 「记住哪些内容」: each filter, defaults, migration of include_tool_calls, injected blocks always out.
import assert from 'node:assert/strict'
import { buildRuntime, createFakeClient, createFakeAgent } from './harness.mjs'
import { resolveConfig, DEFAULT_CONFIG } from '../lib/config.js'

const ok = (m) => console.log('PASS ' + m)
const T = (n) => new Date(Date.UTC(2026, 9, 24, 1, n)).toISOString()
function session({ id = 's1', sub = false } = {}) {
  const ev = [
    { type: 'system/message', time: T(0), data: { turn: 1, step: 0, message: { role: 'system', content: [{ type: 'text', text: '你是白雪，一个温柔的猫娘。' }] } } },
    { type: 'user/message', time: T(1), data: { role: 'user', source: { kind: 'plugin:dsh-hindsight-memory' }, content: [{ type: 'text', text: '<memory-context bank="b">- 旧记忆：用户养猫</memory-context>' }] } },
    { type: 'user/message', time: T(2), data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '我明天要去杭州出差三天，帮我记住酒店是西湖边的那家。<memory-context bank="b">- 偷偷混进来的记忆</memory-context>' }] } },
    { type: 'tool/call', time: T(3), data: { name: 'web_search', arguments: { q: '杭州 天气' } } },
    { type: 'tool/result', time: T(3), data: { message: { content: [{ type: 'text', text: '杭州明天小雨 18 度' }] } } },
    { type: 'assistant/message', time: T(4), data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '用户要出差，应该提醒带伞。'.repeat(80) }, { type: 'text', text: '好的，我记住了：西湖边的酒店，明天小雨记得带伞。' }] } } }
  ]
  const header = { id, cwd: '/tmp/ws-rc', ...(sub ? { origin: 'subagent', parentSession: 'p' } : {}) }
  return { header, id, snapshotEvents: (since = 0) => ev.slice(since) }
}
async function retained(retain, opts = {}) {
  const client = createFakeClient()
  const { runtime } = buildRuntime({ fakeClient: client, rawConfig: { retain: { state_dir: '', ...retain } } })
  if (opts.archived) runtime.workspaceRegistry = { archivedSessionIds: ['s1'] }
  const agent = createFakeAgent({ session: session(opts) })
  if (opts.viaHook) { runtime.onTurnStopping({ agent }); await runtime.flush?.() } else if (!runtime.skipAgent(agent)) await runtime.retainAgent(agent)
  return client.calls.retain.flatMap((c) => c.items).map((i) => i.content).join('\n---\n')
}

// defaults
assert.equal(DEFAULT_CONFIG.retain.include_tool_calls, false)
const d = await retained({})
assert.ok(d.includes('USER（用户本人）: 我明天要去杭州出差') && d.includes('西湖边的酒店，明天小雨'))
assert.ok(!d.includes('[tool') && !d.includes('思考') && !d.includes('系统提示'))
assert.ok(!d.includes('旧记忆') && !d.includes('偷偷混进来'), 'injected memory blocks never retained')
ok('defaults: user + assistant only; tools/reasoning/system off; injected memory blocks stripped')

assert.ok(!(await retained({ include_user: false })).includes('USER（用户本人）'))
ok('我说的话 off')
assert.ok(!(await retained({ retain_assistant: false })).includes('明天小雨记得带伞'))
ok('AI 的回复 off')
const tools = await retained({ include_tool_calls: true, max_tool_chars: 5 })
assert.ok(tools.includes('[tool web_search]') && tools.includes('[tool result] 杭州明天小…'))
ok('工具调用内容 on, max_tool_chars respected')
const r = await retained({ include_reasoning: true, max_reasoning_chars: 50 })
assert.ok(r.includes('的思考过程: [思考] 用户要出差') && r.includes('chars truncated'))
ok('AI 的思考过程 on, truncated')
const s = await retained({ include_system: true })
assert.ok(s.includes('[系统提示] 你是白雪'))
ok('系统提示 on')
assert.equal(await retained({}, { archived: true }), '')
assert.ok((await retained({ include_archived: true }, { archived: true })).includes('杭州'))
ok('已归档的对话 off by default, on when enabled')
assert.equal(await retained({}, { sub: true }), '')
assert.ok((await retained({ include_subagents: true }, { sub: true })).includes('杭州'))
ok('子代理的对话 off by default, on when enabled')
assert.equal(await retained({ min_turn_chars: 5000 }), '')
assert.ok((await retained({ min_turn_chars: 10 })).length > 0)
ok('最短字数')
assert.ok(!(await retained({ include_user: false, retain_assistant: false, include_system: true })).includes('USER'))
ok('turn with nothing selected but system prompt still written only with what is enabled')

// migration: unset -> new default false; explicit true kept
assert.equal(resolveConfig({}, { env: {} }).config.retain.include_tool_calls, false)
assert.equal(resolveConfig({ retain: { include_tool_calls: true } }, { env: {} }).config.retain.include_tool_calls, true)
ok('include_tool_calls: users who never set it get the new default (off); explicit choice kept')
assert.equal(resolveConfig({}, { env: { DSH_HINDSIGHT_RETAIN_REASONING: 'true', DSH_HINDSIGHT_RETAIN_MIN_CHARS: '10' } }).config.retain.include_reasoning, true)
ok('settings can come from .env / environment (DSH_HINDSIGHT_RETAIN_*)')
console.log('\nretain-content tests passed')
