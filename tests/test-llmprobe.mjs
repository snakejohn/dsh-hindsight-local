// Follow-dsh LLM on a loopback gateway only dsh can reach (Tauri cline-pass on 127.0.0.1:3425).
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { isLoopbackUrl, probeLlmReachable } from '../lib/llmprobe.js'

const ok = (m) => console.log('PASS ' + m)
assert.equal(isLoopbackUrl('http://127.0.0.1:3425/v1'), true)
assert.equal(isLoopbackUrl('http://localhost:11434/v1'), true)
assert.equal(isLoopbackUrl('http://[::1]:8000/v1'), true)
assert.equal(isLoopbackUrl('https://api.deepseek.com/v1'), false)
assert.equal(isLoopbackUrl('not a url'), false)
ok('loopback detection')

// remote hosts are never probed (a proxy may be needed that our fetch does not use)
let called = false
let r = await probeLlmReachable('https://api.deepseek.com/v1', { fetchImpl: async () => { called = true; throw new Error('x') } })
assert.deepEqual([r.ok, r.skipped, called], [true, true, false])
ok('remote host skipped')

// nothing listening -> unreachable, with a Chinese reason that names the address, never a key
const srv = createServer((q, s) => { s.writeHead(401); s.end('{}') })
await new Promise((res) => srv.listen(0, '127.0.0.1', res))
const port = srv.address().port
r = await probeLlmReachable(`http://127.0.0.1:${port}/v1`)
assert.equal(r.ok, true) // any HTTP answer (even 401) = reachable
ok('listening gateway is reachable (401 still counts)')
await new Promise((res) => srv.close(res))
r = await probeLlmReachable(`http://127.0.0.1:${port}/v1`, { timeoutMs: 2000 })
assert.equal(r.ok, false)
assert.match(r.reason, /连不上/)
assert.match(r.reason, new RegExp(`127.0.0.1:${port}`))
ok('refused loopback gateway -> fallback reason')
