/**
 * Transcript projection: turns DSH session events into plain `{ user, assistant }` turns.
 *
 * The DSH session log is append-only (`session.snapshotEvents()`), so memory retention
 * reads it instead of hooking the LLM stream. Messages injected by this plugin carry
 * `source.kind = 'plugin:dsh-hindsight-memory'` and are filtered out, which keeps the
 * memory store free of its own recall output (no feedback loop).
 */

import { humanLocal } from './timeparse.js'

export const INJECTION_SOURCE_KIND = 'plugin:dsh-hindsight-memory'

function truncate(text, limit) {
  const value = String(text ?? '')
  if (!limit || value.length <= limit) return value
  return `${value.slice(0, limit)}…(${value.length - limit} chars truncated)`
}

/** Flatten DSH content blocks into readable text. */
export function contentText(content, { maxToolChars = 0, maxReasoningChars = 0 } = {}) {
  if (content === undefined || content === null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    if (typeof content.text === 'string') return content.text
    return ''
  }
  const parts = []
  for (const block of content) {
    if (!block) continue
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    switch (block.type) {
      case 'text':
      case 'input_text':
      case 'output_text':
        if (typeof block.text === 'string') parts.push(block.text)
        break
      case 'reasoning':
        // Thinking is only kept when the caller asks for it (retain.include_reasoning).
        if (maxReasoningChars > 0) {
          const r = typeof block.text === 'string' ? block.text : typeof block.reasoning === 'string' ? block.reasoning : typeof block.summary === 'string' ? block.summary : ''
          if (r) parts.push(`[思考] ${truncate(r, maxReasoningChars)}`)
        }
        break
      case 'tool-call': {
        if (maxToolChars <= 0) break
        const args = block.arguments ?? block.input ?? block.args ?? {}
        let rendered = ''
        try {
          rendered = typeof args === 'string' ? args : JSON.stringify(args)
        } catch {
          rendered = String(args)
        }
        parts.push(`[tool ${block.name || block.toolName || 'call'}] ${truncate(rendered, maxToolChars)}`)
        break
      }
      case 'tool-result': {
        if (maxToolChars <= 0) break
        const out = block.output ?? block.result ?? block.content ?? ''
        const text = typeof out === 'string' ? out : contentText(out, { maxToolChars })
        if (text) parts.push(`[tool result] ${truncate(text, maxToolChars)}`)
        break
      }
      default:
        if (typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.filter(Boolean).join('\n').trim()
}

export function sessionIdOf(session) {
  return (
    session?.header?.id ||
    session?.id ||
    session?.sessionId ||
    ''
  )
}

export function workspacePathOf(agent) {
  return (
    agent?.session?.header?.cwd ||
    agent?.session?.header?.workspace ||
    agent?.options?.cwd ||
    process.cwd()
  )
}

/** SessionHeader.agentPreset (packages/core/session/src/types.ts) — one preset per character. */
export function presetOf(agent) {
  return String(agent?.session?.header?.agentPreset || '')
}

export function isSubagent(agent) {
  const header = agent?.session?.header || {}
  // Real SessionHeader: `origin: 'subagent'` and/or `parentSession: SessionId`.
  return header.origin === 'subagent' || header.parentSession !== undefined
}

export function messageSourceKind(message) {
  return message?.source?.kind ?? message?.sourceKind ?? null
}

export function isUserInput(message) {
  if (!message) return false
  const kind = messageSourceKind(message)
  if (kind === null) return message.role === 'user'
  return kind === 'user'
}

export function isPluginMessage(message) {
  const kind = messageSourceKind(message)
  return typeof kind === 'string' && kind.startsWith('plugin:')
}

function eventDataMessage(event) {
  const data = event?.data ?? {}
  return data.message ?? data.msg ?? (data.role ? data : null)
}

/**
 * Project the session log onto human turns.
 *
 * Returns `{ turns, lastSeq }`. `lastSeq` is the highest event seq consumed, so a caller can
 * resume with `{ sinceSeq }` and only pay for the new tail instead of re-scanning (and
 * re-copying) the whole log on the serial `agent/turn-stopping` hook.
 *
 * `startIndex` lets the caller keep stable turn numbering across incremental calls.
 *
 * @returns {{ turns: Array<{ index:number, startedAt:string, user:string, assistant:string, toolLines:string[] }>, lastSeq:number }}
 */
export function readTurns(session, { includeToolCalls = false, maxToolChars = 400, includeReasoning = false, maxReasoningChars = 600, includeSystem = false, maxSystemChars = 1500, sinceSeq = 0, startIndex = 0, doneSeq = 0 } = {}) {
  let events = []
  try {
    if (session?.snapshotEvents) {
      events = sinceSeq > 0 ? [...session.snapshotEvents(sinceSeq)] : [...session.snapshotEvents()]
    }
  } catch {
    events = []
  }

  const turns = []
  let current = null
  let lastSeq = sinceSeq

  let lastTurnStartSeq = -1
  let pendingSystem = ''
  let lastSystem = ''
  const startTurn = (timestamp, userText, seq) => {
    lastTurnStartSeq = seq
    current = {
      index: startIndex + turns.length,
      startedAt: timestamp || new Date().toISOString(),
      userAt: timestamp || '',
      assistantAt: '',
      user: userText || '',
      assistant: '',
      toolLines: [],
      reasoning: '',
      system: pendingSystem,
      dirty: seq >= doneSeq
    }
    pendingSystem = ''
    turns.push(current)
  }

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    lastSeq = sinceSeq + i + 1
    const type = event?.type || event?.kind || ''
    const data = event?.data || {}
    // SessionEvent.time is epoch milliseconds (core/session/src/types.ts); Hindsight wants ISO.
    const rawTime = event?.time ?? event?.timestamp ?? data.time ?? ''
    const timestamp = typeof rawTime === 'number' && Number.isFinite(rawTime) ? new Date(rawTime).toISOString() : String(rawTime || '')

    if (type === 'system/message') {
      // Only a changed system prompt is attached (to the next turn), never repeated per turn.
      if (!includeSystem) continue
      const message = eventDataMessage(event) || data
      const text = stripInjected(contentText(message?.content ?? data.content, { maxToolChars: 0 }))
      if (text && text !== lastSystem) { lastSystem = text; pendingSystem = truncate(text, maxSystemChars) }
      continue
    }

    if (type === 'user/message') {
      const message = eventDataMessage(event) || data
      if (!isUserInput(message) || isPluginMessage(message)) continue
      const text = stripInjected(contentText(message.content ?? data.content, { maxToolChars: 0 }))
      if (!text) continue
      startTurn(timestamp, text, sinceSeq + i)
      continue
    }

    if (!current) continue

    if (type === 'assistant/message') {
      const message = eventDataMessage(event) || data
      const content = message?.content ?? data.content
      const text = stripInjected(contentText(content, { maxToolChars: 0 }))
      if (includeReasoning) {
        const blocks = Array.isArray(content) ? content.filter((b) => b && b.type === 'reasoning') : []
        const r = contentText(blocks, { maxReasoningChars })
        if (r) current.reasoning = current.reasoning ? `${current.reasoning}\n${r}` : r
      }
      if (text) {
        current.assistant = current.assistant ? `${current.assistant}\n${text}` : text
        if (!current.assistantAt) current.assistantAt = timestamp
        if (sinceSeq + i >= doneSeq) current.dirty = true
      }
      continue
    }

    if (type === 'tool/result' && includeToolCalls) {
      const message = data.message ?? data
      const text = contentText(message?.content ?? data.content ?? '', { maxToolChars: 0 })
      if (text) current.toolLines.push(`[tool result] ${truncate(text, maxToolChars)}`)
      continue
    }

    if (type === 'tool/call' && includeToolCalls) {
      const name = data.name || data.tool || data.toolName || 'tool'
      let args = data.arguments ?? data.input ?? data.args ?? {}
      let rendered = ''
      try {
        rendered = typeof args === 'string' ? args : JSON.stringify(args)
      } catch {
        rendered = String(args)
      }
      current.toolLines.push(`[tool ${name}] ${truncate(rendered, maxToolChars)}`)
    }
  }

  // `resumeSeq` points at the user message that opened the last turn: a turn may keep
  // growing after turn-stopping (steering re-enters the loop), so the next pass re-reads
  // it and re-sends it under the same document_id (Hindsight upserts by document_id)
  // instead of dropping the tail as an orphan assistant message.
  const resumeSeq = lastTurnStartSeq >= 0 ? lastTurnStartSeq : lastSeq
  // Only turns that gained content since the previous pass are re-sent: a completed turn
  // is extracted once, a turn that grew after steering is re-sent (same document_id).
  return { turns: turns.filter((turn) => (turn.user || turn.assistant) && turn.dirty !== false), allTurns: turns.length, lastSeq, resumeSeq }
}

/** The plugin's own recall output is never stored back (no feedback loop), whatever the settings. */
export function stripInjected(text) {
  return String(text || '').replace(/<memory-context\b[^>]*>[\s\S]*?<\/memory-context>/g, '').trim()
}

/** Apply 「记住哪些内容」 to a turn (copy). Reasoning/system/tool parts exist only when enabled. */
export function projectTurn(turn, retain = {}) {
  return {
    ...turn,
    user: retain.include_user === false ? '' : turn.user,
    assistant: retain.retain_assistant === false ? '' : turn.assistant,
    toolLines: retain.include_tool_calls ? turn.toolLines || [] : [],
    reasoning: retain.include_reasoning ? turn.reasoning || '' : '',
    system: retain.include_system ? turn.system || '' : ''
  }
}

/** Render one turn into the text pushed to Hindsight. */
/**
 * One turn as retained text. Each line carries the *real* local time it was said (event
 * time, not import time) and who said it, so the extraction LLM can attribute
 * "用户 07:03 说刷了搞笑视频" correctly and later answer "7点干了啥".
 */
export function renderTurn(turn, { tz, character = '' } = {}) {
  const stamp = (iso) => {
    if (!tz || !iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : `[${humanLocal(d, tz)}] `
  }
  const who = character ? `角色「${character}」(ASSISTANT)` : 'ASSISTANT'
  const lines = []
  if (turn.system) lines.push(`[系统提示] ${turn.system.trim()}`)
  if (turn.user) lines.push(`${stamp(turn.userAt || turn.startedAt)}USER（用户本人）: ${turn.user.trim()}`)
  if (turn.toolLines?.length) lines.push(...turn.toolLines)
  if (turn.reasoning) lines.push(`${who} 的思考过程: ${turn.reasoning.trim()}`)
  if (turn.assistant) lines.push(`${stamp(turn.assistantAt || turn.startedAt)}${who}: ${turn.assistant.trim()}`)
  return lines.join('\n')
}

// CJK text carries about twice the information per character of Latin text, so a short but
// complete Chinese sentence ("睡前喝了热牛奶，11 点前睡觉。") must not fall under min_turn_chars.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g
const weighted = (text) => { const s = String(text || ''); return s.length + (s.match(CJK) || []).length }
export function turnCharCount(turn) {
  return weighted(turn.user) + weighted(turn.assistant) + (turn.toolLines || []).join('').length + weighted(turn.reasoning) + weighted(turn.system)
}

/** The prompt of this step: the concatenated real user messages admitted so far. */
export function promptOf(messages) {
  if (!Array.isArray(messages)) return ''
  const texts = []
  for (const message of messages) {
    if (!isUserInput(message) || isPluginMessage(message)) continue
    const text = contentText(message.content, { maxToolChars: 0 })
    if (text) texts.push(text)
  }
  return texts.join('\n').trim()
}
