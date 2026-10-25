/**
 * Truthful retain progress: Hindsight accepts `async: true` retains immediately (HTTP 200 +
 * operation_id) and runs fact extraction later in its worker. Only the operation status
 * says whether a memory was really written. This tracker polls
 * GET /banks/{bank}/operations/{id}, keeps a small ledger next to the retain cursors,
 * re-queues failed operations with POST .../retry (same payload and document ids, so
 * Hindsight's update_mode=replace never duplicates anything) on an exponential backoff with
 * jitter, and adopts failed retains left over from earlier versions.
 */
import { writeFileAtomic } from './atomic.js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TERMINAL_OK = new Set(['completed'])
const TERMINAL_BAD = new Set(['failed', 'cancelled'])
/** Statuses Hindsight accepts POST .../retry for; anything else answers HTTP 409. */
const RETRYABLE = new Set(['failed', 'cancelled', 'deferred'])
/** HTTP 409 "cannot be retried: status is 'pending'" = the op is already queued/running again. */
export function busyStatusFrom409(error) {
  if (error?.status !== 409) return ''
  const m = /status is '?(pending|processing)'?/i.exec(String(error?.message || '') + ' ' + JSON.stringify(error?.body ?? ''))
  return m ? m[1].toLowerCase() : ''
}

/** Chinese reason for a Hindsight operation error_message (never contains secrets). */
export function zhReason(message = '') {
  const m = String(message)
  // Auth first: a revoked key (401 "Token is invalid") also makes Hindsight fail startup and
  // every later call look like a connection error.
  if (/\b40[13]\b|token is invalid|invalid.?(api.?)?key|authenticationerror|unauthori[sz]ed|forbidden|permission.?denied/i.test(m)) return '密钥无效或已失效'
  if (/\b429\b|rate.?limit|too many requests|限流|quota/i.test(m)) return '模型服务商限流'
  if (/connect|connection|disconnect|timed? ?out|timeout|refused|reset|unreachable/i.test(m)) return '模型服务商限流或连不上'
  if (/dimension|维度/i.test(m)) return '向量维度不一致'
  return '整理失败'
}

export function backoffMs(attempt, { base = 60000, max = 30 * 60000, random = Math.random } = {}) {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt))
  return Math.round(raw * (0.75 + random() * 0.5))
}

export class OpTracker {
  constructor({ client, stateDir = '', logger = console, onCompleted = null, maxAutoRetries = 4, retryBase = 60000, now = () => Date.now(), random = Math.random } = {}) {
    Object.assign(this, { client, stateDir, logger, onCompleted, maxAutoRetries, retryBase, now, random })
    /** @type {Map<string, {id:string, bank:string, session?:string, docs?:string[], status:string, error?:string, reason?:string, attempts:number, nextRetryAt?:number, at:string, adopted?:boolean}>} */
    this.ops = new Map()
    this.completed = 0
    this.load()
  }

  get file() {
    return this.stateDir ? join(this.stateDir, '_operations.json') : ''
  }

  load() {
    if (!this.file) return
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'))
      for (const op of data.ops || []) this.ops.set(op.id, op)
      this.completed = Number(data.completed) || 0
    } catch { /* first run */ }
  }

  save() {
    if (!this.file) return
    try {
      mkdirSync(this.stateDir, { recursive: true })
      writeFileAtomic(this.file, JSON.stringify({ completed: this.completed, ops: [...this.ops.values()] }))
    } catch (error) {
      this.logger.debug?.(`operations ledger write skipped: ${error?.message || error}`)
    }
  }

  /** Record an accepted async retain. */
  add(id, meta = {}) {
    if (!id) return
    this.ops.set(id, { id, status: 'pending', attempts: 0, at: new Date(this.now()).toISOString(), ...meta })
    this.save()
  }

  active() {
    return [...this.ops.values()].filter((o) => !TERMINAL_BAD.has(o.status))
  }

  failed() {
    return [...this.ops.values()].filter((o) => TERMINAL_BAD.has(o.status))
  }

  summary() {
    const failed = this.failed()
    const reasons = {}
    for (const f of failed) reasons[f.reason || '整理失败'] = (reasons[f.reason || '整理失败'] || 0) + 1
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]
    return {
      processing: this.active().length,
      completed: this.completed,
      failed: failed.length,
      reason: top ? top[0] : '',
      failures: failed.slice(0, 30).map((f) => ({ id: f.id, bank: f.bank, session: f.session || '', reason: f.reason, attempts: f.attempts, nextRetryAt: f.nextRetryAt ? new Date(f.nextRetryAt).toISOString() : '', at: f.at }))
    }
  }

  /** Poll every non-terminal op once; schedule/execute auto retries for failed ones. */
  async poll() {
    let changed = false
    for (const op of this.active()) {
      let st
      try {
        st = await this.client.operation(op.bank, op.id)
      } catch (error) {
        if (error?.status === 404) st = { status: 'completed' } // pruned after the retention window = it finished
        else continue
      }
      const status = String(st?.status || 'pending')
      if (TERMINAL_OK.has(status)) {
        this.ops.delete(op.id)
        this.completed += 1
        changed = true
        try { this.onCompleted?.(op) } catch { /* listener errors never break polling */ }
      } else if (TERMINAL_BAD.has(status)) {
        Object.assign(op, { status, error: String(st.error_message || '').slice(0, 300), reason: zhReason(st.error_message) })
        op.nextRetryAt = op.attempts < this.maxAutoRetries ? this.now() + backoffMs(op.attempts, { base: this.retryBase, random: this.random }) : undefined
        this.logger.warn?.(`记忆整理失败（${op.reason}），bank=${op.bank} op=${op.id}${op.nextRetryAt ? `，${Math.round((op.nextRetryAt - this.now()) / 1000)} 秒后自动重试` : ''}`)
        changed = true
      } else if (op.status !== status) {
        op.status = status
        changed = true
      }
    }
    for (const op of this.failed()) {
      if (op.nextRetryAt && op.nextRetryAt <= this.now()) { changed = (await this.retry(op)) || changed; delete op.retried }
    }
    if (this.now() - (this.lastReconcile || 0) >= 60000) {
      this.lastReconcile = this.now()
      changed = (await this.reconcile()) || changed
    }
    if (changed) this.save()
    return this.summary()
  }

  /**
   * Re-queue one failed op. The real Hindsight status is read first: completed/pruned ops are
   * settled, pending/processing ones are shown as 处理中 (never POSTed: that is a 409), and only
   * failed/cancelled/deferred ones are retried.
   * @returns {Promise<boolean>} true when the ledger changed; `op.retried` marks a real re-queue
   */
  async retry(op) {
    op.retried = false
    let st = null
    try { st = await this.client.operation(op.bank, op.id) } catch (error) {
      if (error?.status === 404) { this.ops.delete(op.id); return true }
    }
    const live = st ? String(st.status || '') : ''
    if (live && TERMINAL_OK.has(live)) { this.settle(op); return true }
    if (live && !RETRYABLE.has(live)) { Object.assign(op, { status: live, nextRetryAt: undefined }); return true }
    if (live && st.error_message) Object.assign(op, { error: String(st.error_message).slice(0, 300), reason: zhReason(st.error_message) })
    try {
      await this.client.retryOperation(op.bank, op.id)
      Object.assign(op, { status: 'pending', attempts: op.attempts + 1, nextRetryAt: undefined, retried: true })
      return true
    } catch (error) {
      if (error?.status === 404) { this.ops.delete(op.id); return true }
      const busy = busyStatusFrom409(error)
      if (busy) { Object.assign(op, { status: busy, nextRetryAt: undefined }); return true }
      if (/\b40[13]\b/.test(String(error?.message || '')) || error?.status === 401 || error?.status === 403) op.reason = '密钥无效或已失效'
      op.nextRetryAt = this.now() + backoffMs(op.attempts + 1, { base: this.retryBase, random: this.random })
      this.logger.warn?.(`retry of operation ${op.id} failed: ${error?.message || error}`)
      return true
    }
  }

  settle(op) {
    this.ops.delete(op.id)
    this.completed += 1
    try { this.onCompleted?.(op) } catch { /* listener errors never break polling */ }
  }

  /**
   * Re-read the real status of ledger entries marked failed (they are not polled otherwise), so a
   * failed op that Hindsight re-queued or finished stops showing as 失败.
   */
  async reconcile() {
    let changed = false
    for (const op of this.failed()) {
      let st
      try { st = await this.client.operation(op.bank, op.id) } catch (error) {
        if (error?.status === 404) { this.ops.delete(op.id); changed = true }
        continue
      }
      const live = String(st?.status || '')
      if (!live || live === op.status) continue
      if (TERMINAL_OK.has(live)) this.settle(op)
      else Object.assign(op, { status: live, nextRetryAt: TERMINAL_BAD.has(live) ? op.nextRetryAt : undefined })
      changed = true
    }
    if (changed) this.save()
    return changed
  }

  /** Panel button 「重试失败项」: retry every failed op now (resets the auto-retry budget). */
  async retryAll() {
    let n = 0
    for (const op of this.failed()) {
      op.attempts = 0
      await this.retry(op)
      if (op.retried) n += 1
      delete op.retried
    }
    this.save()
    return n
  }

  /** Pick up failed retains already in Hindsight (e.g. from v0.1.2) so they get retried too. */
  async adopt(bankIds = []) {
    let n = 0
    for (const bank of bankIds) {
      let list
      try {
        list = await this.client.listOperations(bank, { status: 'failed', limit: 100 })
      } catch { continue }
      const all = list?.operations || []
      // Hindsight 1.1 runs a batch_retain parent with retain children (sub-batches); retrying
      // the parent covers the child, so a child is only adopted when it has no parent listed.
      const parentDocs = new Set(all.filter((o) => (o.operation_type || o.task_type) === 'batch_retain').map((o) => o.document_id).filter(Boolean))
      for (const op of this.ops.values()) for (const d of op.docs || []) parentDocs.add(d)
      for (const o of all) {
        const type = o.operation_type || o.task_type
        if (type === 'retain' && (o.result_metadata?.sub_batch_index != null || parentDocs.has(o.document_id ?? o.result_metadata?.document_id))) continue
        if (type && type !== 'retain' && type !== 'batch_retain') continue
        const id = o.operation_id || o.id
        if (!id || this.ops.has(id)) continue
        this.ops.set(id, { id, bank, status: 'failed', attempts: 0, adopted: true, at: o.created_at || new Date(this.now()).toISOString(), error: String(o.error_message || '').slice(0, 300), reason: zhReason(o.error_message), nextRetryAt: this.now() })
        n += 1
      }
    }
    if (n) {
      this.logger.info?.(`found ${n} failed memory operation(s) from before; they will be retried one by one`)
      this.save()
    }
    return n
  }
}
