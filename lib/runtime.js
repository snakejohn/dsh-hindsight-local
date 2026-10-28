/**
 * Runtime: everything the plugin does at run time, decoupled from the Cordis factory so
 * it can be unit-tested with a fake context and a fake agent.
 *
 * Hook map (all confirmed against the installed DSH type definitions):
 *   agent/created        (serial)                            -> bank warm-up, cursor restore
 *   agent/pre-step       (waterfall, awaited before model)   -> recall + inject memory block
 *   agent/turn-stopping  (serial, awaited before commit)     -> schedule async retain
 *   agent/status         (emit)                              -> run the planned prune when idle
 *   agent/disposed       (emit)                              -> drop per-session state
 *   <factory> ctx.effect(...)                                -> boot/health + graceful shutdown
 */
import { writeFileAtomic } from './atomic.js'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger, errorMessage } from './log.js'
import { resolveConfig } from './config.js'
import { migrateDefaultBank, migrateWorkspaceLazily } from './bankmigrate.js'
import { HindsightService } from './lifecycle.js'
import { HindsightClient } from './client.js'
import { dotenvKeyEnv } from './dotenv.js'
import { normalizeWorkspacePath, resolveBankId, slugify, bankIdForName } from './bank.js'
import {
  isPluginMessage,
  isSubagent,
  isUserInput,
  presetOf,
  promptOf,
  readTurns,
  renderTurn,
  sessionIdOf,
  turnCharCount,
  projectTurn,
  workspacePathOf
} from './transcript.js'
import { backfillSessions } from './backfill.js'
import { OpTracker, backoffMs } from './ops.js'
import { isLoopbackUrl, probeLlmReachable } from './llmprobe.js'
import { resolveTimeZone, isoLocal, parseTimeWindow } from './timeparse.js'
import { buildRecallRequest, formatRecallBlock, injectionMessage } from './recall.js'
import { executePrune, planPrune } from './prune.js'

const READY_WAIT_RETAIN_MS = 20000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

export class MemoryRuntime {
  constructor({ config, logger, service, client }) {
    this.config = config
    this.logger = logger
    this.service =
      service ||
      new HindsightService({
        config,
        logger,
        client:
          client ||
          new HindsightClient({
            baseUrl: config.service.base_url,
            apiPrefix: config.service.api_prefix,
            apiKey: config.service.api_key,
            timeoutMs: config.service.request_timeout_ms,
            healthPath: config.service.health_path,
            versionPath: config.service.version_path,
            logger
          })
      })
    this.client = client || this.service.client
    /** @type {Map<string, {bankId:string, rule:string, ensured:boolean, ensuredAt:number}>} */
    this.workspaces = new Map()
    /** bank id -> server display name (Chinese OK), learned in nameBank(). */
    this.bankNames = new Map()
    /** @type {Map<string, object>} */
    this.sessions = new Map()
    /** @type {Set<string>} */
    this.disposedSessions = new Set()
    this.tz = resolveTimeZone(config?.time?.timezone)
    this.now = () => new Date()
    this.compaction = null
    this.inFlight = new Set()
    this.timers = new Set()
    /** Per-bank recall cooldown: one bad bank must not silence every other workspace. */
    this.recallCooldown = new Map()
    this.recallFailures = 0
    this.stats = { recalls: 0, recallsFailed: 0, injections: 0, retains: 0, retainsFailed: 0, prunes: 0, prunesFailed: 0 }
    this.disposed = false
    /** Last retain writes and failures, newest first, for the panel's status page. */
    this.recent = []
    this.failures = []
    /** Progress of the running/last backfill or manual "retain now" job. */
    this.job = null
    /** Async retain operations: truthful progress, failures and auto retry (lib/ops.js). */
    this.ops = new OpTracker({ client: this.client, stateDir: config?.retain?.state_dir || '', logger, onCompleted: (op) => this.markActivity('lastRetain', undefined, op?.bank) })
    /** Persisted so the sidebar survives dsh restarts: lastRetain = an extraction really finished. */
    this.activity = this.#loadActivity()
    this.#initImportState()
    this.opsPolling = null
    /** Local model address (loopback base URL, e.g. a relay on 127.0.0.1) state: writes pause while it is down. */
    this.gateway = { down: false, reason: '', since: '', checkedAt: 0 }
    /** workspaceRegistry (official dsh service): source of the archive set. */
    this.workspaceRegistry = null
    // Legacy bank.default_bank -> explicit per-workspace mappings (recorded ones apply right away).
    this.#migrateLegacyBank()
  }

  /** See lib/bankmigrate.js. Safe to call repeatedly; logs only when something changed. */
  #migrateLegacyBank(workspacePaths = [], complete = false) {
    try {
      if (!this.config?.bank?.default_bank && !(complete && this.config?.bank?.legacy_default_bank)) return null
      if (!this.config.bank.default_bank) this.config.bank.default_bank = this.config.bank.legacy_default_bank
      const r = migrateDefaultBank(this.config, { workspacePaths, complete })
      if (!r) return null
      this.bankMigration = r
      if (r.added.length) {
        this.workspaces.clear()
        this.logger.info(`bank.default_bank "${r.from}" migrated: ${r.added.length} workspace(s) mapped to it explicitly; default_bank no longer routes`)
      }
      return r
    } catch (error) {
      this.logger.warn(`bank.default_bank migration failed: ${errorMessage(error)}`)
      return null
    }
  }

  /** Called once the workspace list is known (dsh workspaceRegistry). */
  migrateLegacyBankFromRegistry(registry = this.workspaceRegistry) {
    if (!this.config?.bank?.legacy_default_bank && !this.config?.bank?.default_bank) return null
    let paths = []
    try { paths = (registry?.list?.() || []).map((w) => w.path).filter(Boolean) } catch { return null }
    return this.#migrateLegacyBank(paths, true)
  }

  /** 「记住哪些内容」: archived sessions / sub-agent sessions are skipped unless switched on. */
  skipArchived(sessionId) {
    return this.config?.retain?.include_archived ? false : this.isArchived(sessionId)
  }

  skipAgent(agent) {
    return isSubagent(agent) && !this.config?.retain?.include_subagents
  }

  /** Archived sessions (dsh `workspaceRegistry.archivedSessionIds`). */
  isArchived(sessionId) {
    try {
      const ids = this.workspaceRegistry?.archivedSessionIds
      return Array.isArray(ids) ? ids.includes(sessionId) : false
    } catch {
      return false
    }
  }

  #record(list, entry) {
    list.unshift({ at: new Date().toISOString(), ...entry })
    if (list.length > 30) list.length = 30
  }

  // ---------------------------------------------------------------- workspace/bank

  workspaceFor(agent) {
    const cwd = normalizeWorkspacePath(workspacePathOf(agent))
    const key = cwd
    const cached = this.workspaces.get(key)
    if (cached) return cached
    // Legacy default_bank not fully migrated yet (no workspace list seen): map this one now.
    if (this.config.bank.legacy_default_bank) {
      try { migrateWorkspaceLazily(this.config, cwd) } catch { /* routing still works */ }
    }
    const resolved = resolveBankId({ workspacePath: cwd, config: this.config })
    const entry = {
      cwd,
      bankId: resolved.bankId,
      rule: resolved.rule,
      matchedKey: resolved.matchedKey,
      displayName: resolved.displayName || '',
      ensured: false,
      ensuredAt: 0
    }
    this.workspaces.set(key, entry)
    this.logger.info(`workspace bank: ${cwd} -> ${entry.bankId} (${entry.rule})`)
    return entry
  }

  async ensureBank(workspace) {
    if (!this.config.bank.ensure_on_use) return
    if (workspace.ensured && Date.now() - workspace.ensuredAt < 60000) return
    await this.client.ensureBank(workspace.bankId, {
      mission: this.config.bank.mission,
      background: this.config.bank.background,
      // The client cache has its own TTL; let it re-PUT once ours expired so a deleted
      // bank heals without a process restart.
      force: !workspace.ensured
    })
    workspace.ensured = true
    workspace.ensuredAt = Date.now()
    void this.nameBank(workspace.bankId, workspace.displayName)
  }

  /**
   * Give the bank a readable (Chinese OK) display name once: only when it has none yet (or
   * just echoes its id), so a bank shared by several workspaces keeps the first/user name.
   */
  async nameBank(bankId, name) {
    if (!this.client.bankProfile || !this.client.setBankName) return false
    this.namedBanks ||= new Set()
    this.namingBanks ||= new Map()
    // A caller arriving while the first lookup is still in flight waits for it, so the name it
    // reads afterwards (bankNames) is already learned.
    if (this.namingBanks.has(bankId)) { await this.namingBanks.get(bankId); return false }
    if (this.namedBanks.has(bankId)) return false
    this.namedBanks.add(bankId)
    const task = this.#nameBankOnce(bankId, name)
    this.namingBanks.set(bankId, task)
    try { return await task } finally { this.namingBanks.delete(bankId) }
  }

  async #nameBankOnce(bankId, name) {
    try {
      const profile = await this.client.bankProfile(bankId)
      const cur = String(profile?.name || '').trim()
      // Remember the server's display name: a workspace that joined an existing bank by id
      // (「接入已有库」) has only the id as its own label, the readable name lives on the bank.
      if (cur && cur !== bankId) { this.bankNames.set(bankId, cur); return false }
      if (!name || name === bankId) { this.namedBanks.delete(bankId); return false }
      await this.client.setBankName(bankId, name)
      this.bankNames.set(bankId, name)
      return true
    } catch (error) {
      this.namedBanks.delete(bankId)
      this.logger.debug(`bank name not set: ${errorMessage(error)}`)
      return false
    }
  }

  sessionState(agent) {
    const id = sessionIdOf(agent.session) || 'unknown'
    let state = this.sessions.get(id)
    if (!state) {
      state = {
        id,
        retainedTurns: 0,
        retainedSeq: 0,
        retaining: false,
        retainQueued: false,
        lastRecallTurn: -1,
        recallCache: new Map(),
        lastPrunedEndSeq: 0,
        pendingPrune: false,
        pruning: false,
        pruneTimer: null,
        lastPruneReason: '',
        warn: {}
      }
      this.sessions.set(id, state)
      this.restoreCursor(state)
    }
    if (!agent.backfill) state.agent = agent
    return state
  }

  warnOnce(state, key, message) {
    if (state.warn[key]) return
    state.warn[key] = true
    this.logger.warn(message)
  }

  // ---------------------------------------------------------------- readiness

  async waitReady(ms) {
    if (this.service.ready) return true
    const pending = this.service.pending
    if (!pending) return false
    const outcome = await Promise.race([pending.catch(() => false), sleep(ms).then(() => false)])
    return outcome === true
  }

  // ---------------------------------------------------------------- recall (read)

  async recallFor(agent, prompt, turn, signal) {
    const cfg = this.config
    if (!cfg.enabled || !cfg.recall.enabled || !prompt) return ''
    if (!this.service.ready) {
      this.service.maybeRetry?.('recall')
      return ''
    }

    const state = this.sessionState(agent)
    const bankIdForCooldown = this.workspaceFor(agent).bankId
    if (Date.now() < (this.recallCooldown.get(bankIdForCooldown) || 0)) return ''
    if (state.lastRecallTurn === turn) return ''

    const cacheKey = prompt.slice(0, 400)
    const ttl = Number(cfg.recall.cache_ms) || 0
    if (ttl > 0) {
      const hit = state.recallCache.get(cacheKey)
      if (hit && Date.now() - hit.at < ttl) {
        state.lastRecallTurn = turn
        return hit.text
      }
    }

    const workspace = this.workspaceFor(agent)
    try {
      await this.ensureBank(workspace)
      const now = this.now()
      const window = parseTimeWindow(prompt, { now, tz: this.tz, windowMinutes: cfg.time?.window_minutes })
      const body = buildRecallRequest(cfg, prompt, { now, tz: this.tz, window })
      const response = await this.client.recall(workspace.bankId, body, {
        timeoutMs: cfg.recall.timeout_ms,
        signal
      })
      const block = formatRecallBlock(response?.results || [], cfg, workspace.bankId, { now, tz: this.tz, window })
      this.stats.recalls += 1
      this.lastRecall = { at: new Date().toISOString(), bank: workspace.bankId, results: (response?.results || []).length }
      this.markActivity('lastRecall', this.lastRecall.at, workspace.bankId)
      this.recallFailures = 0
      this.recallCooldown.delete(workspace.bankId)
      state.lastRecallTurn = turn
      if (ttl > 0) state.recallCache.set(cacheKey, { text: block, at: Date.now() })
      const count = (response?.results || []).length
      this.logger.debug(`recall bank=${workspace.bankId} results=${count} injected=${block ? 'yes' : 'no'}`)
      return block
    } catch (error) {
      this.stats.recallsFailed += 1
      this.recallFailures += 1
      this.service.markUnreachable?.(error)
      // 429 / timeout / embedding outage: back off for this bank instead of retrying every step.
      const cooldownMs = Math.max(0, Number(cfg.recall.cooldown_ms) || 0)
      if (cooldownMs > 0) this.recallCooldown.set(workspace.bankId, Date.now() + cooldownMs)
      this.warnOnce(
        state,
        `recall:${error?.status || 'x'}`,
        `recall failed (${errorMessage(error)}); memory injection paused for ${Math.round(cooldownMs / 1000)}s for bank ` +
          `${workspace.bankId}, conversation continues normally`
      )
      return ''
    }
  }

  // ---------------------------------------------------------------- retain (write)

  /**
   * Called from the serial `agent/turn-stopping` hook, i.e. on the commit boundary.
   * Everything heavy (log snapshot, JSON rendering, HTTP) must happen AFTER the hook
   * returns, so the work is handed to a macrotask instead of running inline.
   */
  scheduleRetain(agent) {
    const cfg = this.config
    if (!cfg.enabled || !cfg.retain.enabled) return
    const task = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer)
        resolve()
      }, 0)
      timer.unref?.()
      this.timers.add(timer)
    })
      .then(() => this.retainAgent(agent))
      .catch((error) => {
        this.stats.retainsFailed += 1
        this.logger.warn(`retain failed: ${errorMessage(error)}`)
        this.service.markUnreachable?.(error)
      })
      .finally(() => {
        this.inFlight.delete(task)
      })
    this.inFlight.add(task)
  }

  buildItems(agent, turns, workspace) {
    const cfg = this.config
    const sessionId = sessionIdOf(agent.session) || 'unknown'
    const wsSlug = slugify(workspace.cwd.replaceAll('/', '-'), 40)
    return turns
      .map((turn) => projectTurn(turn, cfg.retain))
      .filter((turn) => turn.user || turn.assistant || turn.reasoning || turn.toolLines.length)
      .filter((turn) => turnCharCount(turn) >= (Number(cfg.retain.min_turn_chars) || 0))
      .map((turn) => {
        const item = {
          content: renderTurn(turn, { tz: this.tz, character: presetOf(agent) }),
          context: `DSH session ${sessionId} · turn ${turn.index} · ${workspace.cwd}`,
          document_id: `${sessionId}:t${turn.index}`,
          tags: ['dsh', `session:${sessionId}`, `workspace:${wsSlug}`, ...(cfg.retain.tags || [])],
          // Hindsight types MemoryItem.metadata as map<string, string>: numbers are a 422.
          metadata: {
            harness: 'dsh',
            session_id: String(sessionId),
            turn: String(turn.index),
            cwd: workspace.cwd,
            bank_id: workspace.bankId
          }
        }
        // MemoryItem.timestamp ("When the content occurred", ISO 8601): the original event
        // time — for backfilled history too — rendered with the configured zone's offset.
        if (turn.startedAt && !Number.isNaN(Date.parse(turn.startedAt))) {
          item.timestamp = isoLocal(new Date(turn.startedAt), this.tz)
          item.metadata.local_time = item.timestamp
        }
        return item
      })
  }

  /**
   * Retain must also work for a session that was already disposed (a turn can stop right
   * before disposal). In that case use a throwaway state object: writing the cursor file is
   * fine, re-inserting the session into the map would leak it forever.
   */
  retainState(agent) {
    const id = sessionIdOf(agent.session) || 'unknown'
    const existing = this.sessions.get(id)
    if (existing) return existing
    // A live session whose state was never created (no agent/created seen, e.g. the plugin
    // was hot-loaded mid-session, or prune is off so nothing else touched it) must get a
    // real, persistent state — otherwise every pass starts from seq 0 and re-sends the whole
    // log. Only already-disposed sessions get the throwaway object.
    if (!this.disposedSessions.has(id)) return this.sessionState(agent)
    this.disposedStates ||= new Map()
    if (this.disposedStates.has(id)) return this.disposedStates.get(id)
    // Disposed: a queued pass or the ready-flush can still arrive. Read the persisted cursor so
    // it does not start from seq 0 and post the last turn again (seen live: 2 retains per run).
    const throwaway = {
      id,
      retainedTurns: 0,
      retainedSeq: 0,
      retaining: false,
      retainQueued: false,
      lastPruneReason: '',
      warn: {}
    }
    this.restoreCursor(throwaway)
    this.disposedStates.set(id, throwaway)
    if (this.disposedStates.size > 64) this.disposedStates.delete(this.disposedStates.keys().next().value)
    return throwaway
  }

  async retainAgent(agent) {
    const state = this.retainState(agent)
    // Single-flight per session: two turn-stopping hooks in a row must not both send the
    // same slice; the second one just records that another pass is needed.
    if (state.retaining) {
      state.retainQueued = true
      return
    }
    state.retaining = true
    try {
      await this.#retainOnce(agent, state)
    } finally {
      state.retaining = false
      if (state.retainQueued) {
        state.retainQueued = false
        if (!this.disposed) this.scheduleRetain(agent)
      }
    }
  }

  async #retainOnce(agent, state) {
    const sid = sessionIdOf(agent.session)
    if (sid && this.skipArchived(sid)) {
      // Cursor is left untouched: unarchiving later retains the session normally.
      this.logger.debug(`retain skipped: session ${sid} is archived`)
      return
    }
    if (!this.service.ready) {
      this.service.maybeRetry?.('retain')
      const ok = await this.waitReady(READY_WAIT_RETAIN_MS)
      if (!ok) return
    }
    if (this.gateway.down) {
      // Cursor untouched: resumed by checkGateway() once the gateway answers again.
      this.logger.debug(`retain paused: ${this.gateway.reason}`)
      if (this.job?.running) this.pausedDuringJob = true
      return
    }
    const cfg = this.config
    const { turns, allTurns, lastSeq, resumeSeq } = readTurns(agent.session, {
      doneSeq: state.doneSeq ?? state.retainedSeq,
      includeToolCalls: !!cfg.retain.include_tool_calls,
      maxToolChars: cfg.retain.max_tool_chars,
      includeReasoning: !!cfg.retain.include_reasoning,
      maxReasoningChars: cfg.retain.max_reasoning_chars,
      includeSystem: !!cfg.retain.include_system,
      sinceSeq: state.retainedSeq,
      startIndex: state.retainedTurns
    })
    if (!turns.length) return
    const workspace = this.workspaceFor(agent)
    // The last turn is left re-readable (it may still grow), so the next hook re-sends it. When its
    // content did not change, skip it: same document id means no duplicate memory, but Hindsight
    // would still run a second LLM extraction (seen live: two batch_retain ops per one-turn session).
    const itemHash = (it) => createHash('sha1').update(String(it.content ?? '')).digest('hex').slice(0, 16)
    const sent = state.sent || (state.sent = {})
    const built = this.buildItems(agent, turns, workspace)
    const items = built.filter((it) => !(it.document_id && sent[it.document_id] === itemHash(it)))
    if (built.length && !items.length) {
      state.doneSeq = lastSeq
      this.logger.debug(`retain skipped: last turn unchanged (${built.length})`)
      return
    }
    const batchSize = Math.max(1, Number(cfg.retain.max_turns_per_batch) || 8)
    if (!items.length) {
      state.retainedTurns += Math.max(0, (allTurns ?? turns.length) - 1)
      state.retainedSeq = resumeSeq ?? lastSeq
      state.doneSeq = lastSeq
      this.#persistCursor(state)
      return
    }
    await this.ensureBank(workspace)
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await this.client.retain(workspace.bankId, batch, {
              async: cfg.retain.async !== false,
              timeoutMs: Math.max(5000, cfg.service.request_timeout_ms)
            })
            const opIds = [res?.operation_id, ...(res?.operation_ids || [])].filter(Boolean)
            for (const id of opIds) {
              this.ops.add(id, { bank: workspace.bankId, session: sid || '', docs: batch.map((b) => b.document_id) })
            }
            if (!opIds.length) this.markActivity('lastRetain', undefined, workspace.bankId) // synchronous retain: already processed
            this.rateLimit = null
            break
          } catch (error) {
            if (!(isRateLimited(error) || isTransient(error)) || attempt >= 3) throw error
            const wait = backoffMs(attempt, { base: 2000, max: 60000 })
            this.rateLimit = { at: new Date().toISOString(), until: Date.now() + wait, message: errorMessage(error) }
            this.logger.warn(`模型被限流，${Math.round(wait / 1000)} 秒后自动重试（内容已排队，不会丢）`)
            await sleep(wait)
          }
        }
      } catch (error) {
        if (isRateLimited(error)) this.rateLimit = { at: new Date().toISOString(), until: Date.now() + 120000, message: errorMessage(error) }
        this.#record(this.failures, { session: sid, bank: workspace.bankId, turns: batch.length, error: errorMessage(error) })
        throw error
      }
      for (const it of batch) if (it.document_id) sent[it.document_id] = itemHash(it)
      this.stats.retains += batch.length
      this.#record(this.recent, { session: sid, bank: workspace.bankId, turns: batch.length, backfill: !!agent.backfill })
    }
    // Leave the last turn re-readable (see readTurns.resumeSeq): its index is reused, so
    // the re-send overwrites the same document instead of duplicating it.
    state.retainedTurns += Math.max(0, (allTurns ?? turns.length) - 1)
    state.retainedSeq = resumeSeq ?? lastSeq
    state.doneSeq = lastSeq
    this.#persistCursor(state)
    this.logger.info(`retained ${items.length} turn(s) into bank=${workspace.bankId}`)
  }

  // -------------------------------------------------------- retain cursor persistence

  cursorPath(sessionId) {
    const dir = this.config.retain.state_dir
    if (!dir) return ''
    const name = createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16)
    return join(dir, `cursor-${name}.json`)
  }

  /** Best effort: a lost cursor only costs one duplicate upsert, never correctness. */
  #persistCursor(state) {
    const file = this.cursorPath(state.id)
    if (!file) return
    try {
      mkdirSync(join(file, '..'), { recursive: true })
      const sent = Object.fromEntries(Object.entries(state.sent || {}).slice(-8))
      state.sent = sent
      writeFileAtomic(file, JSON.stringify({ session: state.id, turns: state.retainedTurns, seq: state.retainedSeq, done: state.doneSeq ?? state.retainedSeq, sent }))
    } catch (error) {
      this.logger.debug(`cursor write skipped: ${errorMessage(error)}`)
    }
  }

  /** Restore a persisted cursor so a resumed session does not re-retain its whole log. */
  restoreCursor(state) {
    const file = this.cursorPath(state.id)
    if (!file) return
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (Number.isFinite(parsed.turns)) state.retainedTurns = parsed.turns
      if (Number.isFinite(parsed.seq)) state.retainedSeq = parsed.seq
      state.doneSeq = Number.isFinite(parsed.done) ? parsed.done : state.retainedSeq
      if (parsed.sent && typeof parsed.sent === 'object') state.sent = parsed.sent
    } catch {
      /* first run for this session */
    }
  }

  // ---------------------------------------------------------------- prune

  /**
   * Classify one surface node so the pruner knows which nodes are human turns.
   * `eventAt` is the authoritative source: it avoids any assumption about how
   * `deriveMessages()` aligns with surface nodes.
   */
  classifyNode(session, seq) {
    try {
      const event = session.eventAt ? session.eventAt(seq) : null
      if (!event) return 'unknown'
      if (event.type === 'system/message') return 'system'
      if (event.type === 'tool/call' || event.type === 'tool/result') return 'tool'
      if (event.type !== 'user/message') return 'other'
      const message = event.data
      if (!isUserInput(message)) return 'context'
      if (isPluginMessage(message)) return 'context'
      return 'user'
    } catch {
      return 'unknown'
    }
  }

  markPrunePending(agent) {
    if (!this.config.enabled || !this.config.prune.enabled || this.config.prune.mode === 'off') return
    this.sessionState(agent).pendingPrune = true
  }

  async maybePrune(agent) {
    const cfg = this.config
    if (!cfg.enabled || !cfg.prune.enabled || cfg.prune.mode === 'off') return
    if (!this.compaction || !agent?.session) return
    const sessionId = sessionIdOf(agent.session)
    const state = this.sessions.get(sessionId)
    // A timer may outlive the agent: without this guard sessionState() would recreate the
    // entry for a disposed session and prune an agent that no longer exists.
    if (!state || !state.pendingPrune || state.pruning) return

    let nodes
    let nodeKinds
    try {
      nodes = [...(agent.session.surface?.nodes || [])]
      nodeKinds = nodes.map((seq) => this.classifyNode(agent.session, seq))
    } catch (error) {
      this.logger.debug(`prune skipped: cannot read session surface (${errorMessage(error)})`)
      return
    }

    const planned = planPrune({
      nodes,
      nodeKinds,
      config: cfg,
      lastPrunedEndSeq: state.lastPrunedEndSeq
    })
    state.lastPruneReason = planned.reason
    if (!planned.plan) {
      // Nothing to fold right now (below trigger / already pruned / unaligned). Clear the
      // flag so idle events stop rescheduling; the next turn-stopping re-arms it.
      state.pendingPrune = false
      return
    }

    state.pruning = true
    state.pendingPrune = false
    try {
      if (agent.status !== 'idle') await agent.whenIdle()
      if (!this.compaction.compactRegion) {
        this.warnOnce(state, 'prune:unsupported', 'compaction engine has no compactRegion(); history pruning disabled')
        return
      }
      await executePrune({ agent, compaction: this.compaction, plan: planned.plan, logger: this.logger })
      state.lastPrunedEndSeq = planned.plan.endSeq
      // The session log keeps every event, so the retain cursor stays valid after a
      // compaction — do NOT reset it, or the next turn would re-retain old history.
      this.stats.prunes += 1
    } catch (error) {
      this.stats.prunesFailed += 1
      this.warnOnce(
        state,
        'prune:failed',
        `history prune failed (${errorMessage(error)}); native compaction still applies`
      )
    } finally {
      state.pruning = false
    }
  }

  // ---------------------------------------------------------------- hooks

  async onPreStep(payload, decide) {
    try { const sid = sessionIdOf(payload?.agent?.session); const st = sid && this.sessions.get(sid); if (st) st.turnOpen = true } catch { /* best effort */ }
    // `decide()` runs the rest of the waterfall (and possibly the terminal built-in reject).
    // We are registered with prepend:true, i.e. outermost, so an upstream throw would
    // otherwise escape into the agent loop. A memory plugin must never break the turn:
    // fall back to a plain enter with the messages the step already admitted.
    let decision
    try {
      decision = await decide()
    } catch (error) {
      this.logger.warn(`upstream pre-step failed, continuing without memory: ${errorMessage(error)}`)
      return { kind: 'enter', messages: payload?.messages || [] }
    }
    try {
      const cfg = this.config
      if (!cfg.enabled || !cfg.recall.enabled) return decision
      if (!decision || decision.kind !== 'enter') return decision
      const agent = payload?.agent
      if (!agent || isSubagent(agent)) return decision
      const prompt = promptOf(decision.messages)
      const weight = [...prompt].reduce((n, c) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0)
      if (weight < (Number(cfg.recall.min_prompt_chars) || 0)) return decision
      const block = await this.recallFor(agent, prompt, payload.turn, payload.signal)
      if (!block) return decision
      this.stats.injections += 1
      return { ...decision, kind: 'enter', messages: [...decision.messages, injectionMessage(block)] }
    } catch (error) {
      this.logger.warn(`pre-step memory injection skipped: ${errorMessage(error)}`)
      return decision
    }
  }

  onTurnStopping(payload) {
    const st0 = this.sessions.get(sessionIdOf(payload?.agent?.session))
    if (st0) st0.turnOpen = false
    if (!this.config.enabled) return
    const agent = payload?.agent
    if (!agent || this.skipAgent(agent)) return
    this.scheduleRetain(agent)
    this.markPrunePending(agent)
  }

  onIdle(agent) {
    if (!this.config.enabled || !agent) return
    const sessionId = sessionIdOf(agent.session)
    const state = this.sessions.get(sessionId)
    if (!state?.pendingPrune || state.pruneTimer) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      state.pruneTimer = null
      void this.maybePrune(agent).catch((error) =>
        this.logger.warn(`prune scheduling failed: ${errorMessage(error)}`)
      )
    }, 250)
    timer.unref?.()
    state.pruneTimer = timer
    this.timers.add(timer)
  }

  onDisposed(payload) {
    const sessionId = sessionIdOf(payload?.agent?.session)
    if (!sessionId) return
    const state = this.sessions.get(sessionId)
    if (!state) return
    // Drop the pending prune timer first: otherwise it fires after the agent is gone,
    // re-creates the session state inside maybePrune() and leaks the entry forever.
    if (state.pruneTimer) {
      clearTimeout(state.pruneTimer)
      this.timers.delete(state.pruneTimer)
      state.pruneTimer = null
    }
    state.pendingPrune = false
    this.sessions.delete(sessionId)
    this.disposedSessions.add(sessionId)
  }

  attach(ctx) {
    this.ctx = ctx
    // `agent/created` is serial: a throw here would fail agent creation, so everything is
    // wrapped and nothing is awaited.
    ctx.on('agent/created', (payload) => {
      try {
        if (!this.config.enabled) return
        const agent = payload?.agent
        if (!agent || this.skipAgent(agent)) return
        const state = this.sessionState(agent)
        this.restoreCursor(state)
        const workspace = this.workspaceFor(agent)
        if (this.service.ready) void this.ensureBank(workspace).catch(() => {})
      } catch (error) {
        this.logger.debug(`agent/created: ${errorMessage(error)}`)
      }
    })

    ctx.on(
      'agent/pre-step',
      (payload, decide) => this.onPreStep(payload, decide),
      { prepend: true }
    )

    ctx.on('agent/turn-stopping', (payload) => {
      try {
        this.onTurnStopping(payload)
      } catch (error) {
        this.logger.warn(`turn-stopping hook failed: ${errorMessage(error)}`)
      }
    })

    ctx.on('agent/status', (payload) => {
      if (payload?.status === 'idle') this.onIdle(payload.agent)
    })

    ctx.on('agent/disposed', (payload) => this.onDisposed(payload))

    // Catch-up: turns that stopped while Hindsight was still booting/down were left behind
    // the cursor (retain returns without advancing). When the backend turns ready, flush
    // every live session instead of waiting for its next turn, then run the backfill.
    this.persistence = null
    try {
      ctx.inject(['sessionPersistence'], (scope) => {
        this.persistence = scope.sessionPersistence
        this.#maybeBackfill()
        return () => { this.persistence = null }
      })
    } catch (error) {
      this.logger.debug(`sessionPersistence not available: ${errorMessage(error)}`)
    }
    try {
      ctx.inject(['workspaceRegistry'], (scope) => {
        this.workspaceRegistry = scope.workspaceRegistry
        this.migrateLegacyBankFromRegistry(scope.workspaceRegistry)
        return () => { this.workspaceRegistry = null }
      })
    } catch (error) {
      this.logger.debug(`workspaceRegistry not available: ${errorMessage(error)}`)
    }
    const poll = Math.max(1000, Number(this.config.retain.catchup_poll_ms) || 5000)
    let wasReady = this.service.ready
    const tick = () => {
      if (this.disposed) return
      const ready = this.service.ready
      if (ready && !wasReady) this.#onBackendReady()
      if (ready) void this.checkGateway().then(() => { if (!this.gateway.down) return this.pollOps() })
      if (!ready) this.service.maybeRetry?.('catch-up')
      wasReady = ready
      const t = setTimeout(tick, poll)
      t.unref?.()
      this.timers.add(t)
    }
    const t0 = setTimeout(tick, poll)
    t0.unref?.()
    this.timers.add(t0)
    try {
      ctx.inject(['compaction'], (scope) => {
        this.compaction = scope.compaction
        this.logger.info('compaction engine bound: history pruning enabled')
      })
    } catch (error) {
      this.logger.debug(`compaction not available: ${errorMessage(error)}`)
    }
  }

  #onBackendReady() {
    this.logger.info('memory backend ready: flushing turns written while it was unavailable')
    // Skip agents mid-turn: their turn-stopping hook retains the finished turn. Flushing now
    // posted the half turn (user text only) and then the full one: two extractions (seen live).
    for (const state of this.sessions.values()) if (state.agent && !state.turnOpen) this.scheduleRetain(state.agent)
    void this.adoptFailedOps()
    this.#maybeBackfill()
  }

  /** Loopback extraction LLM (e.g. a local relay dsh uses): null when not applicable. */
  gatewayUrl() {
    const llm = this.config.llm || {}
    if (llm.mode === 'none' || !llm.provider || llm.provider === 'none') return null
    return llm.base_url && isLoopbackUrl(llm.base_url) ? llm.base_url : null
  }

  /**
   * While the local gateway is down every extraction fails, so writes pause instead of
   * piling up failed operations (and never fall back to raw-only). When it answers again:
   * failed operations are re-queued, live sessions flushed and the backfill resumed.
   */
  async checkGateway({ force = false } = {}) {
    // Single flight: the tick loop and an RPC may ask at the same time.
    if (this.gatewayChecking) return this.gatewayChecking
    this.gatewayChecking = this.#checkGateway({ force }).finally(() => { this.gatewayChecking = null })
    return this.gatewayChecking
  }

  async #checkGateway({ force = false } = {}) {
    const url = this.gatewayUrl()
    if (!url) { this.gateway.down = false; return true }
    const every = this.gateway.down ? 5000 : 15000
    if (!force && Date.now() - this.gateway.checkedAt < every) return !this.gateway.down
    this.gateway.checkedAt = Date.now()
    const probe = await probeLlmReachable(url, { fetchImpl: this.fetchImpl })
    if (!probe.ok && !this.gateway.down) {
      Object.assign(this.gateway, { down: true, since: new Date().toISOString(), reason: `模型地址 ${new URL(url).host} 连不上，请确认对应的程序已启动；连上后会自动继续` })
      this.logger.warn(`${this.gateway.reason}（暂停写入记忆）`)
    } else if (probe.ok && this.gateway.down) {
      Object.assign(this.gateway, { down: false, reason: '', since: '' })
      this.logger.info('模型地址已连上：重试失败项并继续记忆')
      await this.ops.retryAll().catch(() => 0)
      for (const state of this.sessions.values()) if (state.agent) this.scheduleRetain(state.agent)
      // Rerun the job that was interrupted by the outage (cursors make this idempotent).
      if (!this.job?.running) {
        if (this.lastJob && this.pausedDuringJob) void this.runJob(this.lastJob.kind, this.lastJob.filter)
        else if (this.backfillStarted) void this.runJob('backfill', {})
      }
      this.pausedDuringJob = false
    }
    return !this.gateway.down
  }

  /**
   * 「要导入以前的对话吗？」 card: shown once on a fresh install. Installs that already have
   * retain cursors (older versions imported history) never see it. Decided once, before this process writes any cursor: a state dir with cursors = existing install. */
  #initImportState() {
    const dir = this.config.retain?.state_dir
    if (!dir) return
    try {
      if (existsSync(join(dir, '_import.json'))) return
      const prior = existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.json') && !f.startsWith('_'))
      this.dismissImport(prior ? 'existing-install' : 'pending')
    } catch { /* read-only */ }
  }

  #activityFile() {
    const dir = this.config?.retain?.state_dir
    return dir ? join(dir, '_activity.json') : ''
  }

  #loadActivity() {
    try { const f = this.#activityFile(); return f ? JSON.parse(readFileSync(f, 'utf8')) : {} } catch { return {} }
  }

  markActivity(kind, at = new Date().toISOString(), bank = '') {
    // lastBank: the bank last used by a chat — the status page opens "看看记住了什么" on it.
    this.activity = { ...(this.activity || {}), [kind]: at, ...(bank ? { lastBank: bank } : {}) }
    const f = this.#activityFile()
    if (!f) return
    try { mkdirSync(this.config.retain.state_dir, { recursive: true }); writeFileAtomic(f, JSON.stringify(this.activity)) } catch { /* read-only state dir */ }
  }

  importPrompt() {
    const dir = this.config.retain?.state_dir
    if (!dir) return false
    try {
      return JSON.parse(readFileSync(join(dir, '_import.json'), 'utf8')).decided === 'pending'
    } catch {
      return false
    }
  }

  dismissImport(how = 'dismissed') {
    const dir = this.config.retain?.state_dir
    if (!dir) return
    try {
      mkdirSync(dir, { recursive: true })
      writeFileAtomic(join(dir, '_import.json'), JSON.stringify({ decided: how, at: new Date().toISOString() }))
    } catch { /* read-only */ }
  }

  /** Conversations for the single-conversation picker (titles when the store has them). */
  async listSessions({ workspace = '' } = {}) {
    if (!this.persistence?.list) return []
    const want = workspace ? normalizeWorkspacePath(workspace) : ''
    const snaps = await this.persistence.list({})
    return snaps
      .map((s) => s.header || {})
      .filter((h) => h.id && !this.skipArchived(h.id) && (!want || normalizeWorkspacePath(h.cwd || '') === want))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 200)
      .map((h) => ({ id: h.id, title: String(h.title || h.name || h.summary || '').slice(0, 80), createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : '', cwd: h.cwd || '', retained: (() => { try { const f = this.cursorPath(h.id); return !!f && existsSync(f) } catch { return false } })() }))
  }

  /** How many async retains may be in Hindsight's queue at once (panel 「同时处理数」). */
  concurrency() {
    const n = Math.round(Number(this.config.service?.local?.concurrency) || 1)
    return Math.min(4, Math.max(1, n))
  }

  async pollOps() {
    if (this.opsPolling) return this.opsPolling
    this.opsPolling = this.ops.poll().catch((error) => this.logger.debug(`operations poll failed: ${errorMessage(error)}`)).finally(() => { this.opsPolling = null })
    return this.opsPolling
  }

  /** Banks this plugin writes to; a shared external Hindsight may hold other apps' banks. */
  ownsBank(id) {
    if (/^dsh-|(^|-)bk-[0-9a-f]{8}$/.test(id)) return true
    for (const w of this.workspaces.values()) if (w.bankId === id) return true
    const b = this.config.bank || {}
    const named = [b.default_bank, b.legacy_default_bank, ...Object.values(b.workspace_bank_mapping || {})].filter(Boolean)
    return named.some((n) => bankIdForName(n) === id)
  }

  /** Failed retains from before this version (or another run) get retried as well. */
  async adoptFailedOps() {
    if (this.opsAdopted || !this.client.listBanks) return
    this.opsAdopted = true
    try {
      const banks = await this.client.listBanks()
      await this.ops.adopt(banks.map((b) => b.bank_id || b.id).filter((id) => id && this.ownsBank(id)))
    } catch (error) {
      this.opsAdopted = false
      this.logger.debug(`adopt failed operations skipped: ${errorMessage(error)}`)
    }
  }

  /**
   * Backfill throttle: wait until fewer than concurrency() retains are still being processed,
   * so a first start with dozens of conversations does not burst a free/relay LLM.
   */
  async waitForCapacity(signal, { pollMs = 3000, maxWaitMs = 20 * 60000 } = {}) {
    const limit = this.concurrency()
    const until = Date.now() + maxWaitMs
    while (!this.disposed && !signal?.aborted && Date.now() < until) {
      if (!(await this.checkGateway())) { await sleep(pollMs); continue }
      await this.pollOps()
      if (this.ops.active().length < limit) return true
      await sleep(pollMs)
    }
    return false
  }

  #maybeBackfill() {
    if (this.service.ready) void this.adoptFailedOps()
    if (this.backfillStarted || !this.persistence || !this.service.ready) return
    if (!this.config.enabled || !this.config.retain.enabled || this.config.backfill?.enabled === false) return
    this.backfillStarted = true
    void this.runJob('backfill', {})
  }

  /**
   * Backfill or a manual "retain now" (panel button / `/memory-retain` command).
   * Deduplicated by the same per-session cursor and deterministic document ids as live
   * retention, so pressing it twice re-extracts nothing. One job at a time.
   * @param {'backfill'|'manual'} kind
   * @param {{ sessionIds?: string[], workspaces?: string[] }} filter
   */
  async runJob(kind, filter = {}) {
    if (this.job?.running) return { started: false, job: this.job }
    if (!this.persistence) return { started: false, reason: 'sessionPersistence unavailable' }
    if (!this.service.ready) return { started: false, reason: 'Hindsight not ready' }
    if (kind === 'manual') this.dismissImport('imported')
    this.lastJob = { kind, filter }
    const job = { kind, running: true, startedAt: new Date().toISOString(), total: 0, done: 0, scanned: 0, skipped: 0, failed: 0, archived: 0 }
    this.job = job
    const task = backfillSessions({
      runtime: this,
      persistence: this.persistence,
      config: kind === 'manual' ? { ...this.config, backfill: { ...this.config.backfill, max_sessions: 0, since: '' } } : this.config,
      logger: this.logger,
      filter,
      progress: (p) => Object.assign(job, p)
    })
      .then((summary) => Object.assign(job, summary))
      .catch((error) => { job.error = errorMessage(error); this.logger.warn(`${kind} failed: ${job.error}`) })
      .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); this.inFlight.delete(task) })
    this.inFlight.add(task)
    return { started: true, job }
  }

  async boot(reason = 'startup') {
    if (!this.config.enabled) {
      this.logger.info('memory backend disabled by config (enabled=false); using native DSH context')
      return false
    }
    try {
      const ok = await this.service.ensureReady(reason)
      if (ok) {
        this.#maybeBackfill()
        this.logger.info(
          `memory ready (bank template "${this.config.bank.name_template}", recall budget ${this.config.recall.budget})`
        )
      }
      return ok
    } catch (error) {
      this.logger.warn(`memory boot failed: ${errorMessage(error)}; continuing without memory`)
      return false
    }
  }

  async flush() {
    const timeout = Math.max(1000, Number(this.config.retain.flush_timeout_ms) || 8000)
    if (!this.inFlight.size) return
    await Promise.race([Promise.allSettled([...this.inFlight]), sleep(timeout)])
  }

  async shutdown() {
    if (this.disposed) return
    this.disposed = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    for (const state of this.sessions.values()) state.pruneTimer = null
    await this.flush()
    try {
      await this.service.stop()
    } catch (error) {
      this.logger.warn(`shutdown: ${errorMessage(error)}`)
    }
  }
}

export function createRuntime({ rawConfig = {}, ctx = null, runner, client } = {}) {
  // Keys come from the plugin .env (process env still wins); see lib/dotenv.js KEY_VARS.
  const { config, warnings } = resolveConfig(rawConfig, { env: { ...dotenvKeyEnv(), ...process.env } })
  const logger = createLogger({
    level: config.logging.level,
    file: config.logging.file || undefined,
    console: config.logging.console,
    ctxLogger: ctx?.logger ? safeLogger(ctx.logger) : null
  })
  for (const warning of warnings) logger.warn(warning)
  const runtime = new MemoryRuntime({ config, logger, client, service: runner ? new HindsightService({ config, logger, runner, client }) : undefined })
  return { runtime, config, logger, warnings }
}

function safeLogger(loggerService) {
  try {
    return typeof loggerService === 'function' ? loggerService('dsh-memory') : null
  } catch {
    return null
  }
}


/** HTTP 429 / quota / rate-limit errors (from Hindsight or an upstream model API). */
/** Connection-level failures (relay refusing under load, dropped sockets): retried with backoff. */
export function isTransient(error) {
  const s = Number(error?.status)
  if (s === 502 || s === 503 || s === 504) return true
  const code = error?.cause?.code || error?.code || ''
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(code) || /fetch failed|socket hang up|other side closed/i.test(String(error?.message || ''))
}

export function isRateLimited(error) {
  const status = error?.status ?? error?.statusCode
  if (status === 429) return true
  return /\b429\b|rate.?limit|too many requests|quota|TPM|RPM|limit exceeded|限流|请求过于频繁/i.test(String(error?.message || error) + ' ' + String(error?.body || ''))
}
