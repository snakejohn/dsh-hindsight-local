/**
 * Backfill: replay sessions that already exist in DSH's session store into Hindsight.
 *
 * Source of truth is the official `sessionPersistence` service
 * (packages/session/session-persistence/src/index.ts: list() / open(id,'read');
 * handle.ts: read(offset,length) -> { events }). The default backend is
 * dsh-session-persistence-jsonl: one directory per session under the configured root,
 * `session.vN.jsonl[.zstd]` (zstd-compressed by default), so reading the files directly
 * would need a Zstandard decoder and the format-migration catalog — going through the
 * service avoids both and never takes write ownership.
 *
 * Dedup / progress: every session goes through MemoryRuntime.retainAgent(), i.e. the same
 * per-session cursor file (retain.state_dir/<session>.json) and deterministic
 * document_id (`<session>:t<turn>`) as live retention, so a re-run, a crash mid-backfill or
 * a session that is later resumed never double-retains (Hindsight update_mode=replace).
 */
import { isSubagent } from './transcript.js'
import { normalizeWorkspacePath } from './bank.js'

export async function backfillSessions({ runtime, persistence, config, logger, signal, filter = {}, progress = () => {} }) {
  const cfg = config.backfill || {}
  const summary = { listed: 0, scanned: 0, skipped: 0, failed: 0, archived: 0 }
  const onlySessions = filter.sessionIds?.length ? new Set(filter.sessionIds) : null
  const onlyWorkspaces = filter.workspaces?.length ? filter.workspaces.map(normalizeWorkspacePath) : null
  if (!persistence?.list) {
    logger.info('backfill: sessionPersistence service not available; skipped')
    return summary
  }
  let snapshots = []
  try {
    snapshots = await persistence.list({ signal })
  } catch (error) {
    logger.warn(`backfill: list() failed: ${error?.message || error}`)
    return summary
  }
  summary.listed = snapshots.length
  const max = Number(cfg.max_sessions) || Infinity
  const since = cfg.since ? Date.parse(cfg.since) : NaN
  // Oldest first so memories accrue in story order.
  const ordered = [...snapshots]
    .filter((snap) => {
      const h = snap.header || {}
      if (onlySessions && !onlySessions.has(h.id)) return false
      if (onlyWorkspaces && !onlyWorkspaces.includes(normalizeWorkspacePath(h.cwd || ''))) return false
      return true
    })
    .sort((a, b) => (a.header?.createdAt ?? 0) - (b.header?.createdAt ?? 0))
  progress({ total: ordered.length, done: 0 })
  let done = 0
  for (const snap of ordered) {
    // Not gated on runtime.disposed: shutdown's bounded flush() lets it finish; progress is per-session anyway.
    if (signal?.aborted) break
    if (summary.scanned >= max) break
    const header = snap.header || {}
    const fake = { session: { header } }
    progress({ done: done++, current: header.id, ...summary })
    // Archived sessions (workspaceRegistry archive set) are excluded from Hindsight entirely.
    if (header.id && runtime.isArchived?.(header.id)) {
      summary.archived += 1
      summary.skipped += 1
      continue
    }
    if (!header.id || isSubagent(fake) || (!onlySessions && runtime.sessions.has(header.id)) || runtime.isRetainedUpTo?.(header.id, snap.eventCount)) {
      summary.skipped += 1
      continue
    }
    if (Number.isFinite(since) && Number(header.createdAt) < since) {
      summary.skipped += 1
      continue
    }
    let handle
    try {
      handle = await persistence.open(header.id, 'read', { signal })
      const { events } = await handle.read(0, undefined, { signal })
      const session = {
        header,
        snapshotEvents: (from = 0) => events.slice(from),
        eventAt: (seq) => events[seq]
      }
      const live = runtime.sessions.get(header.id)
      if (live?.agent) await runtime.retainAgent(live.agent) // live session: retain from its own log
      else {
        await runtime.retainAgent({ session, backfill: true })
        if (!live) runtime.sessions.delete(header.id) // keep the cursor file, drop the in-memory state
      }
      summary.scanned += 1
      if (cfg.pause_ms) await new Promise((r) => setTimeout(r, cfg.pause_ms))
    } catch (error) {
      summary.failed += 1
      logger.warn(`backfill: session ${header.id} failed: ${error?.message || error}`)
    } finally {
      await handle?.close?.().catch(() => {})
    }
  }
  progress({ done, current: '', ...summary })
  logger.info(`backfill done: listed=${summary.listed} scanned=${summary.scanned} (already-retained turns are skipped by the cursor) skipped=${summary.skipped} archived=${summary.archived} failed=${summary.failed}`)
  return summary
}
