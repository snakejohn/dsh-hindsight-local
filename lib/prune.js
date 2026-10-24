/**
 * Prune: shrink old history by folding the oldest turns into one summary node.
 *
 * Why not delete messages? A DSH session log is append-only and every event stays
 * addressable (`snapshotEvents`, rewind, replay), so the supported way to shrink the
 * *model-facing* history is `ctx.compaction.compactRegion(start, end, ...)`: it replaces
 * the region with a summary node, keeps tool-call/result pairing intact, and keeps the
 * session event log whole. This plugin therefore never mutates the log; it only decides
 * *where* the cut goes — right before the first user turn that must stay verbatim.
 *
 * Node classification is delegated to the caller (it reads `session.eventAt(seq)`), so
 * this module stays pure and testable.
 */

/** @typedef {'user'|'context'|'system'|'tool'|'other'|'unknown'} NodeKind */

/**
 * @param {{ nodes:number[], nodeKinds:NodeKind[], config:object, lastPrunedEndSeq?:number }} args
 * @returns {{ reason:string, plan?: { startSeq:number, endSeq:number, droppedTurns:number, keptTurns:number } }}
 */
export function planPrune({ nodes, nodeKinds, config, lastPrunedEndSeq = 0 }) {
  if (!Array.isArray(nodes) || !Array.isArray(nodeKinds) || nodes.length === 0) return { reason: 'no-history' }
  if (nodes.length !== nodeKinds.length) return { reason: 'unaligned' }

  const userIndexes = []
  nodeKinds.forEach((kind, index) => {
    if (kind === 'user') userIndexes.push(index)
  })

  const totalTurns = userIndexes.length
  const keep = Math.max(1, Number(config.prune.keep_recent_turns) || 6)
  const trigger = Math.max(keep + 1, Number(config.prune.trigger_after_turns) || 12)
  const minPrune = Math.max(1, Number(config.prune.min_prune_turns) || 2)

  if (totalTurns < trigger) return { reason: `below-trigger(${totalTurns}/${trigger})` }
  if (totalTurns <= keep) return { reason: 'nothing-to-prune' }

  const keepFromIndex = userIndexes[totalTurns - keep]
  const startIndex = userIndexes[0]
  const endIndex = keepFromIndex - 1
  if (endIndex <= startIndex) return { reason: 'nothing-to-prune' }

  const droppedTurns = totalTurns - keep
  if (droppedTurns < minPrune) return { reason: `below-min(${droppedTurns}/${minPrune})` }

  // Any system-prompt node inside the range must never be summarised away.
  for (let i = startIndex; i <= endIndex; i += 1) {
    if (nodeKinds[i] === 'system') return { reason: 'range-hits-system-node' }
  }

  // Never let the cut land on a tool node: compactRegion validates call/result pairing, and
  // moving the boundary back onto the preceding turn keeps the pair inside one region.
  let cutIndex = endIndex
  while (cutIndex > startIndex && nodeKinds[cutIndex] === 'tool') cutIndex -= 1
  if (cutIndex <= startIndex) return { reason: 'degenerate-range' }

  // Seq numbers are only compared by equality/ordering inside one surface generation: after a
  // `replace` op the visible seqs are not guaranteed monotonic, so no magnitude math here.
  const startSeq = nodes[startIndex]
  const endSeq = nodes[cutIndex]
  if (!Number.isFinite(startSeq) || !Number.isFinite(endSeq) || startSeq === endSeq) {
    return { reason: 'degenerate-range' }
  }
  if (lastPrunedEndSeq === endSeq) return { reason: 'already-pruned' }

  return { reason: 'ok', plan: { startSeq, endSeq, droppedTurns, keptTurns: keep } }
}

/**
 * Run the planned compaction. Must be called while the agent is idle
 * (`runMaintenance` owns the exclusive slot and supplies the abort signal).
 */
export async function executePrune({ agent, compaction, plan, logger, compressionOptions }) {
  // dsh-compaction-basic's compactRegion(start, end, agent, signal) needs the real Agent:
  // it reads agent.session and routes the summarizer through the agent. A hand-made
  // { session, options } object only satisfies the abstract type, not the implementation.
  void compressionOptions
  await agent.runMaintenance(async (signal) => {
    await compaction.compactRegion(plan.startSeq, plan.endSeq, agent, signal)
  })
  logger?.info?.(
    `pruned history: seq ${plan.startSeq}..${plan.endSeq} -> summary ` +
      `(dropped ${plan.droppedTurns} turns, kept ${plan.keptTurns})`
  )
  return plan
}
