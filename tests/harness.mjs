/**
 * Test harness: a fake Cordis context, fake DSH session/agent, and fake Hindsight client.
 * These fakes mirror the shapes documented in the installed DSH type definitions, so the
 * plugin is exercised through the same hook contract it uses in production.
 */
import { createLogger } from '../lib/log.js'
import { MemoryRuntime } from '../lib/runtime.js'
import { resolveConfig } from '../lib/config.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export function testLogFile(name) {
  return join(tmpdir(), `dsh-memory-test-${name}-${process.pid}.log`)
}

export function makeLogger(name = 'test') {
  return createLogger({ level: 'debug', file: testLogFile(name) })
}

/** Waterfall/emit semantics of a Cordis context, enough for this plugin. */
export function createFakeCtx({ services = {}, logger = null } = {}) {
  const listeners = new Map()
  const effects = []
  const injected = []
  const ctxLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  }

  const ctx = {
    logger: () => ctxLogger,
    on(event, listener, options = {}) {
      if (!listeners.has(event)) listeners.set(event, [])
      const list = listeners.get(event)
      if (options.prepend) list.unshift(listener)
      else list.push(listener)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    inject(deps, callback) {
      injected.push({ deps, callback })
      const available = deps.every((dep) => services[dep] !== undefined)
      if (available) callback({ ...ctx, ...pickServices(services, deps) })
      return true
    },
    effect(execute) {
      const disposer = execute()
      effects.push(disposer)
      return () => (typeof disposer === 'function' ? disposer() : undefined)
    }
  }

  return Object.assign(ctx, {
    ctx,
    listeners,
    effects,
    injected,
    has: (event) => (listeners.get(event) || []).length > 0,
    /**
     * Run an `emit` event. Real `agentEvents.emit` isolates listeners: one throwing listener
     * is reported, never propagated. The fake mirrors that so hook-error semantics are tested.
     */
    emitErrors: [],
    emit(event, payload) {
      for (const listener of [...(listeners.get(event) || [])]) {
        try {
          const result = listener(payload)
          if (result && typeof result.then === 'function') result.then(undefined, () => {})
        } catch (error) {
          ctx.emitErrors.push({ event, error })
        }
      }
    },
    /** Run a `waterfall` event, threading `next()`. */
    async waterfall(event, payload, terminal = () => undefined) {
      const list = [...(listeners.get(event) || [])]
      let index = 0
      const next = async () => {
        if (index >= list.length) return terminal(payload)
        const listener = list[index]
        index += 1
        return listener(payload, next)
      }
      return next()
    },
    /** Run a `serial` event (all listeners awaited in order). */
    async serial(event, payload) {
      for (const listener of [...(listeners.get(event) || [])]) await listener(payload)
    },
    async dispose() {
      const result = []
      for (const disposer of effects.reverse()) {
        if (typeof disposer === 'function') result.push(await disposer())
      }
      return result
    }
  })
}

function pickServices(services, deps) {
  const out = {}
  for (const dep of deps) out[dep] = services[dep]
  return out
}

/**
 * Build a session whose shapes match the real DSH log: `surface.nodes` holds real
 * event seqs (1-based), `eventAt(seq)` resolves them, and `deriveMessages()` returns one
 * message per surface node — including the leading `system/message` node.
 */
export function buildSession({ id = 'session-1', cwd = '/tmp/workspace-alpha', turns = [], injectedBefore = '', withSystem = true }) {
  /** @type {Array<object>} */
  const log = []
  const nodes = []
  const messages = []
  const append = (event) => {
    log.push(event)
    return log.length
  }
  const appendSurface = (event, message) => {
    const seq = append(event)
    nodes.push(seq)
    messages.push(message)
    return seq
  }

  let time = Date.parse('2026-10-23T10:00:00.000Z')
  const stamp = () => new Date((time += 1000)).toISOString()

  if (withSystem) {
    const systemMessage = { role: 'system', content: [{ type: 'text', text: 'You are a helpful coding agent.' }] }
    appendSurface({ type: 'system/message', time: stamp(), data: { turn: 1, step: 0, message: systemMessage } }, systemMessage)
  }

  if (injectedBefore) {
    const injected = {
      role: 'user',
      content: [{ type: 'text', text: injectedBefore }],
      source: { kind: 'plugin:dsh-hindsight-memory', form: 'recall' }
    }
    appendSurface({ type: 'user/message', time: stamp(), data: injected }, injected)
  }

  for (const turn of turns) {
    const userMessage = {
      role: 'user',
      content: [{ type: 'text', text: turn.user }],
      source: { kind: turn.sourceKind || 'user' }
    }
    appendSurface({ type: 'user/message', time: stamp(), data: userMessage }, userMessage)

    if (turn.tool) {
      append({
        type: 'tool/call',
        time: stamp(),
        data: {
          turn: 1,
          step: 1,
          callId: `call-${log.length}`,
          name: turn.tool.name,
          arguments: typeof turn.tool.arguments === 'string' ? turn.tool.arguments : JSON.stringify(turn.tool.arguments)
        }
      })
      const toolResult = {
        role: 'tool',
        content: [{ type: 'text', text: turn.tool.result || 'ok' }]
      }
      append({ type: 'tool/result', time: stamp(), data: { turn: 1, step: 1, callId: `call-${log.length}`, message: toolResult } })
    }

    if (turn.assistant !== undefined) {
      const assistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: turn.assistant }]
      }
      appendSurface({ type: 'assistant/message', time: stamp(), data: { turn: 1, step: 1, message: assistantMessage } }, assistantMessage)
    }
  }

  const session = {
    header: { id, cwd },
    surface: { nodes, replaceGeneration: 0, contentGeneration: 0 },
    log,
    events: log,
    messages,
    // Real sessions accept an `afterSeq` filter; the plugin relies on it for incremental reads.
    snapshotEvents: (afterSeq = 0) => (afterSeq > 0 ? log.slice(afterSeq) : [...log]),
    deriveMessages: () => messages,
    eventAt: (seq) => log[seq - 1]
  }
  return session
}

/**
 * Append one more turn to an existing fake session, keeping every projection aligned.
 */
export function appendTurn(session, turn) {
  const { log } = session
  const userMessage = { role: 'user', content: [{ type: 'text', text: turn.user }], source: { kind: 'user' } }
  log.push({ type: 'user/message', time: new Date().toISOString(), data: userMessage })
  session.surface.nodes.push(log.length)
  session.messages.push(userMessage)
  if (turn.assistant !== undefined) {
    const assistantMessage = { role: 'assistant', content: [{ type: 'text', text: turn.assistant }] }
    log.push({ type: 'assistant/message', time: new Date().toISOString(), data: { turn: 1, step: 1, message: assistantMessage } })
    session.surface.nodes.push(log.length)
    session.messages.push(assistantMessage)
  }
  return session
}

export function createFakeAgent({ session, status = 'running', options = { provider: 'p', model: 'm' } }) {
  const agent = {
    session,
    options,
    status,
    maintenanceTasks: [],
    async whenIdle() {
      agent.status = 'idle'
      return undefined
    },
    async runMaintenance(task) {
      agent.maintenanceTasks.push(task)
      return task(new AbortController().signal)
    }
  }
  return agent
}

/** A Hindsight stand-in that records traffic instead of making it. */
export function createFakeClient({ results = [], failRecall = null, failRetain = null } = {}) {
  const calls = { ensureBank: [], recall: [], retain: [], health: [] }
  return {
    calls,
    ensuredBanks: new Set(),
    async health() {
      calls.health.push(Date.now())
      return { ok: true, status: 200, body: { status: 'healthy' } }
    },
    async version() {
      return { api_version: '1.1.0-test' }
    },
    async ensureBank(bankId, options) {
      calls.ensureBank.push({ bankId, options })
      this.ensuredBanks.add(bankId)
      return { bankId, created: true }
    },
    async recall(bankId, body, options) {
      calls.recall.push({ bankId, body, options })
      if (failRecall) throw failRecall
      return { results }
    },
    async retain(bankId, items, options) {
      calls.retain.push({ bankId, items, options })
      if (failRetain) throw failRetain
      return { success: true, items_count: items.length, async: options?.async }
    }
  }
}

export function buildRuntime({ fakeClient, rawConfig = {}, serviceOverrides = {} } = {}) {
  const logger = makeLogger('runtime')
  // Tests must never touch the real cursor store (~/.dsh-hindsight/state); a suite that
  // wants to exercise persistence passes an explicit temp `retain.state_dir`.
  const isolated = { retain: { state_dir: '' }, logging: { file: '', console: false }, ...rawConfig }
  isolated.retain = { state_dir: '', ...(rawConfig.retain || {}) }
  const { config, warnings } = resolveConfig(isolated, { env: {} })
  const service = {
    state: 'ready',
    ready: true,
    pending: null,
    client: fakeClient,
    async ensureReady() {
      return true
    },
    async stop() {
      this.stopped = true
    },
    ...serviceOverrides
  }
  const runtime = new MemoryRuntime({ config, logger, service, client: fakeClient })
  return { runtime, config, logger, service, warnings }
}

export function memoryResult(text, score = 0.8, type = 'world') {
  return {
    id: `mem-${text.length}-${score}`,
    text,
    type,
    scores: { final: score, reranker: score, semantic: 0.5, keyword: 1.2 },
    occurred_end: '2026-10-20T00:00:00.000Z'
  }
}
