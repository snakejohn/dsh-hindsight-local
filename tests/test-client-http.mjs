/**
 * Unit tests: transport layer (http.js) and the Hindsight client surfaces the reviewer
 * flagged — configurable health/version paths, bank-upsert cache TTL and health status.
 * Run: node tests/test-client-http.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { HttpError, joinUrl, requestJson } from '../lib/http.js'
import { HindsightClient } from '../lib/client.js'
import { makeLogger } from './harness.mjs'

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

// 1. Timeout is surfaced as an error, not a hang.
{
  const { server, base } = await listen((req, res) => {
    setTimeout(() => res.end('late'), 500)
  })
  try {
    const started = Date.now()
    await assert.rejects(() => requestJson(joinUrl(base, '/slow'), { timeoutMs: 80 }))
    assert.ok(Date.now() - started < 400, 'timeout fires on schedule')
    console.log('PASS request timeout aborts the call')
  } finally {
    server.close()
  }
}

// 2. An abort signal cancels an in-flight request.
{
  const { server, base } = await listen((req, res) => {
    setTimeout(() => res.end('late'), 500)
  })
  try {
    const controller = new AbortController()
    const pending = requestJson(joinUrl(base, '/slow'), { timeoutMs: 5000, signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await assert.rejects(pending, /abort/i)
    console.log('PASS abort signal cancels the request')
  } finally {
    server.close()
  }
}

// 3. Non-JSON error bodies still surface status + raw text (no JSON parse crash).
{
  const { server, base } = await listen((req, res) => {
    res.statusCode = 502
    res.end('<html>bad gateway</html>')
  })
  try {
    await assert.rejects(
      () => requestJson(joinUrl(base, '/x'), { timeoutMs: 2000 }),
      (error) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.status, 502)
        assert.match(error.body, /bad gateway/)
        return true
      }
    )
    console.log('PASS non-JSON error body keeps status and text')
  } finally {
    server.close()
  }
}

// 4. HttpError carries status and body.
{
  const { server, base } = await listen((req, res) => {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ detail: 'Bank not found' }))
  })
  try {
    await assert.rejects(
      () => requestJson(joinUrl(base, '/missing'), { timeoutMs: 2000 }),
      (error) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.status, 404)
        assert.match(error.body, /Bank not found/)
        return true
      }
    )
    console.log('PASS HttpError exposes status and body text')
  } finally {
    server.close()
  }
}

// 5. health_path / version_path come from config, and only 2xx counts as healthy.
{
  const seen = []
  const { server, base } = await listen((req, res) => {
    seen.push(req.url)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/custom/healthz') return res.end(JSON.stringify({ status: 'healthy' }))
    if (req.url === '/custom/ver') return res.end(JSON.stringify({ api_version: '9.9.9' }))
    res.statusCode = 404
    res.end(JSON.stringify({ detail: 'nope' }))
  })
  try {
    const client = new HindsightClient({
      baseUrl: base,
      healthPath: '/custom/healthz',
      versionPath: '/custom/ver',
      logger: makeLogger('client')
    })
    const health = await client.health()
    assert.equal(health.ok, true)
    assert.deepEqual(seen, ['/custom/healthz'])
    const version = await client.version()
    assert.equal(version.api_version, '9.9.9')
    assert.ok(seen.includes('/custom/ver'))
    console.log('PASS health/version paths follow the configuration')
  } finally {
    server.close()
  }
}

// 6. A 5xx health response is not "ready".
{
  const { server, base } = await listen((req, res) => {
    res.statusCode = 503
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'starting' }))
  })
  try {
    const client = new HindsightClient({ baseUrl: base, logger: makeLogger('client') })
    const health = await client.health()
    assert.equal(health.ok, false)
    assert.equal(health.status, 503)
    assert.match(health.error, /503/)
    console.log('PASS 5xx health response is treated as not ready')
  } finally {
    server.close()
  }
}

// 7. ensureBank cache expires, so a deleted bank heals without a restart.
{
  let puts = 0
  const { server, base } = await listen((req, res) => {
    if (req.method === 'PUT' && req.url.startsWith('/v1/default/banks/')) {
      puts += 1
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ bank_id: 'b', created: true }))
    }
    res.statusCode = 404
    res.end('{}')
  })
  try {
    const client = new HindsightClient({ baseUrl: base, ensureCacheMs: 60, logger: makeLogger('client') })
    await client.ensureBank('bank-a')
    await client.ensureBank('bank-a')
    assert.equal(puts, 1, 'a fresh cache hit skips the request')
    await new Promise((resolve) => setTimeout(resolve, 90))
    await client.ensureBank('bank-a')
    assert.equal(puts, 2, 'an expired cache re-issues the idempotent PUT')
    await client.ensureBank('bank-a', { force: true })
    assert.equal(puts, 3, 'force always re-issues')
    console.log('PASS bank upsert cache expires and honours force')
  } finally {
    server.close()
  }
}

console.log('\nclient/http tests passed')
