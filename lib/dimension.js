/**
 * Embedding dimension guard. Hindsight 1.1.0 fixes the pgvector column size when the database
 * is created (migrations.py `_migrate_table_embedding_dimension`): on startup it ALTERs an
 * empty table to the model's dimension, but refuses to start when the table already holds
 * vectors of another size. The model's dimension comes from HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS
 * when set (also forwarded to the provider as `dimensions`), else a built-in table or a probe.
 *
 * The plugin keeps its own "expected" dimension (embedding.expected_dim, default 1024 = bge-m3,
 * mirrored to .env as DSH_HINDSIGHT_EMBEDDING_DIM) and, before launching the local server,
 * compares it with (a) one real embedding call and (b) the dimension recorded the last time
 * this database started successfully. Any disagreement blocks the start with a Chinese hint,
 * so nothing is written with the wrong size and existing data is never touched.
 */
import { writeFileAtomic } from './atomic.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_DIM = 1024
export const DIM_ENV = 'DSH_HINDSIGHT_EMBEDDING_DIM'
export const dimStatePath = (home = homedir()) => join(process.env.DSH_HINDSIGHT_STATE_HOME || join(home, '.dsh-hindsight'), 'embedding-dim.json')

export function expectedDim(env = {}, config = {}) {
  const n = Number(env[DIM_ENV] || config.embedding?.expected_dim || DEFAULT_DIM)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DIM
}

/** One embedding request against an OpenAI-compatible endpoint; null when not possible. */
export async function probeEmbeddingDim({ provider, baseUrl, apiKey, model, dimensions, fetchImpl = fetch, timeoutMs = 15000 }) {
  if (String(provider || '').toLowerCase() !== 'openai' || !baseUrl || !model) return { dim: null, reason: 'unsupported' }
  const body = { model, input: ['维度检测 dimension probe'] }
  if (Number(dimensions) > 0) body.dimensions = Number(dimensions)
  try {
    const res = await fetchImpl(String(baseUrl).replace(/\/+$/, '') + '/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const text = await res.text()
    if (!res.ok) return { dim: null, reason: `HTTP ${res.status}`, status: res.status, body: text.slice(0, 200) }
    const vec = JSON.parse(text)?.data?.[0]?.embedding
    return Array.isArray(vec) ? { dim: vec.length } : { dim: null, reason: 'no embedding in response' }
  } catch (error) {
    return { dim: null, reason: String(error?.message || error) }
  }
}

export function readRecordedDim(dbUrl, path = dimStatePath()) {
  try { return JSON.parse(readFileSync(path, 'utf8'))[dbUrl] || null } catch { return null }
}

export function recordDim(dbUrl, info, path = dimStatePath()) {
  let all = {}
  try { if (existsSync(path)) all = JSON.parse(readFileSync(path, 'utf8')) } catch { all = {} }
  all[dbUrl] = { ...info, at: new Date().toISOString() }
  try { mkdirSync(dirname(path), { recursive: true }); writeFileAtomic(path, JSON.stringify(all, null, 2)) } catch { /* best effort */ }
}

/** Compare the three numbers; returns Chinese errors (empty = consistent). */
export function compareDims({ expected, probed, recorded, model }) {
  const errors = []
  if (probed && probed !== expected) {
    errors.push(`向量维度不一致：设置里填的是 ${expected}，但模型「${model || ''}」实际输出 ${probed} 维。请在「高级设置 → 理解文字的模型 → 向量维度」改成 ${probed}，或换回原来的模型。为了不损坏已有记忆，本地记忆服务暂不启动。`)
  }
  const now = probed || expected
  if (recorded?.dim && recorded.dim !== now) {
    errors.push(`记忆库里已存的向量是 ${recorded.dim} 维（模型 ${recorded.model || '未知'}），现在的设置是 ${now} 维，两者必须一致。请把「向量维度」和模型改回 ${recorded.dim} 维的设置；如果确实要换成不同维度的模型，需要先备份并换一个新的空记忆库（见使用文档「迁移和备份记忆」）。为了不损坏已有记忆，本地记忆服务暂不启动。`)
  }
  return errors
}
