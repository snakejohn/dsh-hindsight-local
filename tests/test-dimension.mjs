/** Embedding dimension guard + CJK min_turn_chars weighting. No key needed (fake fetch). */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HINDSIGHT_LOG_DIR ||= mkdtempSync(join(tmpdir(), 'hs-dim-'))
const { DEFAULT_DIM, expectedDim, probeEmbeddingDim, compareDims, recordDim, readRecordedDim } = await import('../lib/dimension.js')
const { explainFailure } = await import('../lib/deploy.js')
const { localEnv } = await import('../lib/local.js')
const { DEFAULT_CONFIG } = await import('../lib/config.js')
const { turnCharCount } = await import('../lib/transcript.js')
let pass = 0
const ok = (name) => { pass++; console.log('PASS', name) }
const fakeFetch = (n, status = 200) => async (url, init) => ({ ok: status === 200, status, text: async () => status === 200 ? JSON.stringify({ data: [{ embedding: new Array(n).fill(0) }] }) : '{"code":20015}', _body: init.body })

assert.equal(DEFAULT_CONFIG.embedding.expected_dim, 1024)
assert.equal(localEnv(DEFAULT_CONFIG).DSH_HINDSIGHT_EMBEDDING_DIM, '1024')
assert.equal(localEnv(DEFAULT_CONFIG).HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS, undefined, 'never send dimensions by default (SiliconFlow bge-m3 rejects it)')
assert.equal(expectedDim({}), DEFAULT_DIM)
assert.equal(expectedDim({ DSH_HINDSIGHT_EMBEDDING_DIM: '768' }), 768)
ok('default 1024 in config/.env, dimensions param not sent')

const p = await probeEmbeddingDim({ provider: 'openai', baseUrl: 'http://x/v1', apiKey: 'k', model: 'BAAI/bge-m3', fetchImpl: fakeFetch(1024) })
assert.equal(p.dim, 1024)
assert.equal((await probeEmbeddingDim({ provider: 'openai', baseUrl: 'http://x/v1', model: 'm', fetchImpl: fakeFetch(0, 400) })).dim, null)
assert.equal((await probeEmbeddingDim({ provider: 'onnx', model: 'm' })).reason, 'unsupported')
ok('probe reads model output size; failures are non-fatal')

assert.deepEqual(compareDims({ expected: 1024, probed: 1024, recorded: { dim: 1024 } }), [])
assert.deepEqual(compareDims({ expected: 1024, probed: null, recorded: null }), [])
const e1 = compareDims({ expected: 768, probed: 1024, recorded: null, model: 'BAAI/bge-m3' })
assert.equal(e1.length, 1); assert.match(e1[0], /向量维度不一致.*768.*1024/)
const e2 = compareDims({ expected: 768, probed: null, recorded: { dim: 1024, model: 'BAAI/bge-m3' } })
assert.equal(e2.length, 1); assert.match(e2[0], /已存的向量是 1024 维/)
ok('mismatch (768 vs 1024) produces Chinese blocking hints')

const f = join(mkdtempSync(join(tmpdir(), 'dimst-')), 'd.json')
recordDim('pg0://a', { dim: 1024, model: 'm' }, f)
assert.equal(readRecordedDim('pg0://a', f).dim, 1024)
assert.equal(readRecordedDim('pg0://b', f), null)
ok('recorded database dimension persists per database url')

assert.match(explainFailure('RuntimeError: Cannot change embedding dimension from 1024 to 768', ''), /向量维度不一致/)
ok('server-side dimension error is explained in Chinese')

assert.equal(turnCharCount({ user: '睡前喝了一杯热牛奶，11 点前睡觉。', assistant: '作息不错。' }) >= 24, true)
assert.equal(turnCharCount({ user: 'abcd', assistant: 'ef' }), 6)
ok('CJK counts double for min_turn_chars')
console.log(`${pass} pass`)
