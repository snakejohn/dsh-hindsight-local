/**
 * Offline mock of the Hindsight 1.1 HTTP API (only the endpoints the plugin uses).
 * Validates request bodies against field names from hindsight-docs/static/openapi.json
 * (unknown fields => 422, like FastAPI with extra=forbid would surface misuse) and does a
 * naive keyword recall so retain->recall round-trips can be exercised without any model/key.
 * Usage: node tests/mock-hindsight.mjs [port]   (default 18888)
 */
import http from 'node:http'
const ALLOWED = {
  bank: ['name', 'mission', 'background', 'disposition', 'retain_mission', 'enable_reranking', 'reflect_mission', 'observations_mission', 'enable_observations', 'retain_extraction_mode', 'disposition_skepticism', 'disposition_literalism', 'disposition_empathy'],
  retain: ['items', 'async', 'document_tags', 'operation_id'],
  item: ['content', 'timestamp', 'context', 'metadata', 'document_id', 'entities', 'tags', 'observation_scopes', 'strategy', 'update_mode', 'attachments'],
  recall: ['query', 'types', 'budget', 'max_tokens', 'trace', 'query_timestamp', 'include', 'tags', 'tags_match', 'tag_groups', 'min_scores', 'document_ids']
}
const banks = new Map()
const log = []
const bad = (res, msg) => { res.writeHead(422, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: msg })) }
const extra = (obj, keys) => Object.keys(obj || {}).filter((k) => !keys.includes(k))
export function createMock() {
  return http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : {}
    log.push({ method: req.method, url: req.url, body })
    const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    const m = req.url.match(/^\/v1\/default\/banks\/([^/]+)(\/memories(\/recall)?)?$/)
    if (req.url === '/health') return send({ status: 'healthy', database: 'connected' })
    if (req.url === '/version') return send({ api_version: '1.1.0-mock', features: { observations: false } })
    if (req.url === '/v1/default/banks' && req.method === 'GET') return send({ banks: [...banks.keys()].map((bank_id) => ({ bank_id })) })
    const sm = req.url.match(/^\/v1\/default\/banks\/([^/]+)\/(stats|memories\/list)(\?.*)?$/)
    if (sm && req.method === 'GET') {
      const b = banks.get(decodeURIComponent(sm[1])) || { mem: [] }
      if (sm[2] === 'stats') return send({ bank_id: sm[1], total_nodes: b.mem.length, total_links: 0, total_documents: new Set(b.mem.map((x) => x.document_id)).size, nodes_by_fact_type: { world: b.mem.length }, pending_operations: 0, failed_operations: 0 })
      const qs = new URLSearchParams(sm[3] || '')
      const q = (qs.get('q') || '').toLowerCase()
      const items = b.mem.filter((x) => !q || x.content.toLowerCase().includes(q)).map((x) => ({ id: x.id, text: x.content, context: x.context || '', date: x.timestamp || null, fact_type: 'world', tags: x.tags || [] }))
      const off = Number(qs.get('offset') || 0), lim = Number(qs.get('limit') || 50)
      return send({ items: items.slice(off, off + lim), total: items.length, limit: lim, offset: off })
    }
    if (!m) return send({ detail: 'not found' }, 404)
    const id = decodeURIComponent(m[1])
    if (!m[2] && (req.method === 'PUT' || req.method === 'PATCH')) {
      const e = extra(body, ALLOWED.bank); if (e.length) return bad(res, `unknown bank fields ${e}`)
      if (!banks.has(id)) banks.set(id, { profile: body, mem: [] })
      return send({ bank_id: id, name: body.name || id, disposition: {}, mission: body.mission || '' })
    }
    if (!m[2] && req.method === 'GET') return banks.has(id) ? send({ bank_id: id, name: id, disposition: {}, mission: '' }) : send({ detail: 'no bank' }, 404)
    const bank = banks.get(id) || banks.set(id, { mem: [] }).get(id)
    if (m[2] && !m[3] && req.method === 'POST') {
      const e = extra(body, ALLOWED.retain); if (e.length) return bad(res, `unknown retain fields ${e}`)
      for (const it of body.items || []) {
        const ie = extra(it, ALLOWED.item); if (ie.length) return bad(res, `unknown item fields ${ie}`)
        if (typeof it.content !== 'string' || !it.content) return bad(res, 'content required')
        for (const [k, v] of Object.entries(it.metadata || {})) if (typeof v !== 'string') return bad(res, `metadata.${k} must be string`)
        if (it.timestamp && Number.isNaN(Date.parse(it.timestamp))) return bad(res, `bad timestamp ${it.timestamp}`)
        if (it.document_id) bank.mem = bank.mem.filter((x) => x.document_id !== it.document_id) // update_mode=replace
        bank.mem.push({ ...it, id: `m${log.length}-${bank.mem.length}` })
      }
      return send({ success: true, bank_id: id, items_count: (body.items || []).length, async: !!body.async, operation_id: body.async ? 'op-1' : null })
    }
    if (m[3] && req.method === 'POST') {
      const e = extra(body, ALLOWED.recall); if (e.length) return bad(res, `unknown recall fields ${e}`)
      if (body.budget && !['low', 'mid', 'high'].includes(body.budget)) return bad(res, 'budget')
      if (body.tags_match && !['any', 'all', 'any_strict', 'all_strict', 'exact'].includes(body.tags_match)) return bad(res, 'tags_match')
      const terms = String(body.query || '').toLowerCase().split(/[\s,，。?？]+/).filter(Boolean)
      const chars = [...String(body.query || '')].filter((c) => /[\u4e00-\u9fff]/.test(c))
      const results = bank.mem
        .filter((x) => !body.tags?.length || body.tags.some((t) => (x.tags || []).includes(t)))
        .map((x) => {
          const t = x.content.toLowerCase()
          const hit = terms.filter((w) => t.includes(w)).length + chars.filter((c) => t.includes(c)).length / 4
          return { x, s: Math.min(1, hit / Math.max(1, terms.length)) }
        })
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(({ x, s }) => ({ id: x.id, text: x.content.slice(0, 300), type: 'world', document_id: x.document_id, tags: x.tags, metadata: x.metadata, mentioned_at: x.timestamp, scores: { final: s } }))
      return send({ results })
    }
    return send({ detail: 'method' }, 405)
  })
}
export const mockLog = log
export const mockBanks = banks
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 18888)
  createMock().listen(port, '127.0.0.1', () => console.log(`mock hindsight on http://127.0.0.1:${port}`))
}
