// Log housekeeping and redacted export (v0.1.3).
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, utimesSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { redact, collapseRepeats, rotateFile, cleanupLogs, exportLogs } from '../lib/logfiles.js'
import { createLogger } from '../lib/log.js'

const ok = (m) => console.log('PASS ' + m)
const FAKE = 'sk-' + 'abcdefghijklmnopqrstuvwxyz0123456789'
const samples = [
  `key=${FAKE}`,
  `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig`,
  `HINDSIGHT_API_LLM_API_KEY=${'plainsecretvalue123'}`,
  `{"api_key":"${'another-secret-value'}","model":"x"}`,
  `SILICONFLOW_API_KEY: "${'zzzzzzzzzzzzzzzz'}"`,
  `https://user:${'p4ssw0rd'}@proxy.local:8080`,
  `GET /models?api_key=${'qqqqqqqqqqqq'}&x=1`,
  `token ghp_${'A'.repeat(30)}`
]
const out = redact(samples.join('\n'))
for (const s of [FAKE, 'eyJhbGciOiJIUzI1NiJ9', 'plainsecretvalue123', 'another-secret-value', 'zzzzzzzzzzzzzzzz', 'p4ssw0rd', 'qqqqqqqqqqqq', 'A'.repeat(30)]) assert.ok(!out.includes(s), 'leaked: ' + s.slice(0, 6))
assert.match(out, /"model":"x"/)
assert.match(redact('HINDSIGHT_API_LLM_API_KEY=(已设置)'), /\(已设置\)/, 'set/unset markers stay readable')
assert.equal(redact('模型地址 127.0.0.1:3425 连不上'), '模型地址 127.0.0.1:3425 连不上')
ok('redact removes sk-/Bearer/*_API_KEY/json api_key/url passwords/query tokens, keeps normal text')

const spam = Array.from({ length: 2000 }, (_, i) => `2026-10-24 16:0${i % 10}:00,123 - WARNING - LLM call failed: Connection error (attempt ${i % 6}/6)`).join('\n') + '\nother line'
const c = collapseRepeats(spam)
assert.ok(c.split('\n').length <= 3 && /又重复了 1999 次/.test(c) && c.endsWith('other line'))
ok('collapse thousands of identical retry lines into one + count')

const dir = mkdtempSync(join(tmpdir(), 'logs-'))
const f = join(dir, 'hindsight.log')
writeFileSync(f, 'x'.repeat(2000))
assert.equal(rotateFile(f, { maxBytes: 1000, keep: 3 }), true)
assert.equal(statSync(f).size, 0, 'truncated in place (works with an open append handle)')
assert.ok(existsSync(f + '.1'))
for (let i = 0; i < 5; i++) { writeFileSync(f, 'y'.repeat(2000) + i); rotateFile(f, { maxBytes: 1000, keep: 3 }) }
assert.deepEqual(readdirSync(dir).sort(), ['hindsight.log', 'hindsight.log.1', 'hindsight.log.2', 'hindsight.log.3'])
assert.equal(rotateFile(f, { maxBytes: 1000 }), false, 'small file untouched')
ok('size rotation keeps the last 3 files')

const old = join(dir, 'hindsight.log.3')
const t = (Date.now() - 20 * 86400000) / 1000
utimesSync(old, t, t)
writeFileSync(join(dir, 'export-old.txt'), 'z'); utimesSync(join(dir, 'export-old.txt'), t, t)
const removed = cleanupLogs(dir, { totalCapBytes: 1e9 })
assert.deepEqual(removed.sort(), ['export-old.txt', 'hindsight.log.3'])
const removed2 = cleanupLogs(dir, { totalCapBytes: 2100 })
assert.ok(removed2.length >= 1 && existsSync(f), 'cap deletes oldest rotated files, never the live log')
ok('age (14 days) and total size cap cleanup')

writeFileSync(f, `2026-10-24 boot\nusing key ${FAKE}\n` + 'retry Connection error\n'.repeat(50))
const p = exportLogs({ dir, files: ['hindsight.log', 'missing.log'], version: '0.1.3', summary: { llm: { api_key: 'secret-in-config-xyz', model: 'm' } } })
const body = readFileSync(p, 'utf8')
assert.ok(body.includes('插件版本: 0.1.3') && body.includes('hindsight.log') && body.includes('又重复了'))
assert.ok(!body.includes(FAKE) && !body.includes('secret-in-config-xyz'))
ok('export: version, OS, settings summary and recent logs, all redacted')

const lf = join(dir, 'plugin.log')
const lg = createLogger({ level: 'info', file: lf })
for (let i = 0; i < 1200; i++) lg.warn('retain failed: fetch failed')
lg.info('done')
const lines = readFileSync(lf, 'utf8').trim().split('\n')
assert.ok(lines.length <= 6, 'plugin logger collapses repeats: ' + lines.length)
assert.ok(lines.some((l) => /又重复了/.test(l)))
ok('plugin logger collapses repeated lines')
