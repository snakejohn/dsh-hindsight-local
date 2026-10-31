/**
 * 「重启服务」 with keep_alive_on_exit: the running server is really stopped (ours, or one kept
 * alive by an earlier session we only attached to) so the fresh start uses the new settings;
 * a normal exit / settings reload still leaves it running; a user's own server is never touched.
 * Run: node tests/test-restart-keepalive.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const logDir = mkdtempSync(join(tmpdir(), 'hs-restart-'))
process.env.DSH_HINDSIGHT_LOG_DIR = logDir
const { HindsightService } = await import('../lib/lifecycle.js')
const { resolveConfig } = await import('../lib/config.js')
const { makeLogger } = await import('./harness.mjs')

let passed = 0
const ok = (m) => { passed += 1; console.log('PASS ' + m) }
const good = { ok: true, status: 200, body: { status: 'healthy' } }
const bad = { ok: false, status: 0, error: 'ECONNREFUSED' }

function cfg(setup, service = {}) {
  return resolveConfig({ setup, service: { base_url: 'http://127.0.0.1:18891', keep_alive_on_exit: true, shutdown_grace_ms: 500, health_timeout_ms: 200, retry_interval_ms: 20, startup_timeout_ms: 2000, ...service } }, { env: {} }).config
}

/** A kept-alive server from an earlier session: alive until signalled; /health follows it. */
function keptAlive({ pid = 424242, ignoreTerm = false } = {}) {
  const st = { alive: true, signals: [] }
  const pidFile = join(logDir, `pid-${pid}`)
  writeFileSync(pidFile, String(pid))
  const procs = {
    pidFile,
    sleepMs: 5,
    minGraceMs: 400,
    alive: (p) => p === pid && st.alive,
    kill: (p, sig) => { st.signals.push([p, sig]); if (Math.abs(p) !== pid) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); if (sig === 'SIGKILL' || !ignoreTerm) st.alive = false }
  }
  const client = { async health() { return st.alive ? good : bad }, async version() { return {} }, async listBanks() { return [] } }
  return { st, procs, client, pidFile }
}
const runner = async () => ({ ok: false, code: 1, stdout: '', stderr: 'no docker' })

// Detached children are unref'd (as in dsh): keep this test process alive while they run.
const keep = setInterval(() => {}, 1000)
try {
  {
    const k = keptAlive()
    const service = new HindsightService({ config: cfg('local'), logger: makeLogger('t'), runner, client: k.client, procs: k.procs })
    assert.equal(await service.ensureReady('startup'), true)
    assert.equal(service.launchMode, 'attach', 'attached to the kept-alive server')
    await service.stop({ restart: true })
    assert.deepEqual(k.st.signals[0], [-424242, 'SIGTERM'], 'graceful SIGTERM to its process group first')
    assert.equal(k.st.signals.some(([, s]) => s === 'SIGKILL'), false, 'no SIGKILL when it exits in time')
    assert.equal(k.st.alive, false)
    assert.equal(existsSync(k.pidFile), false, 'pid file cleared')
    ok('restart stops a server kept alive by an earlier session (attached, not our child)')
  }
  {
    const k = keptAlive({ pid: 424243 })
    const service = new HindsightService({ config: cfg('local'), logger: makeLogger('t'), runner, client: k.client, procs: k.procs })
    await service.ensureReady('startup')
    await service.stop()
    assert.equal(k.st.signals.length, 0)
    assert.equal(k.st.alive, true)
    ok('normal exit / settings reload still keeps it alive (keep_alive_on_exit honoured)')
  }
  {
    const k = keptAlive({ pid: 424244 })
    const service = new HindsightService({ config: cfg('existing'), logger: makeLogger('t'), runner, client: k.client, procs: k.procs })
    await service.ensureReady('startup')
    await service.stop({ restart: true })
    assert.equal(k.st.signals.length, 0, 'never stop a server the user pointed us at')
    ok('setup=existing: restart never stops the server')
  }
  {
    const k = keptAlive({ pid: 424245, ignoreTerm: true })
    const service = new HindsightService({ config: cfg('local', { shutdown_grace_ms: 500 }), logger: makeLogger('t'), runner, client: k.client, procs: k.procs })
    await service.ensureReady('startup')
    const t0 = Date.now()
    await service.stop({ restart: true })
    assert.ok(Date.now() - t0 >= 390, 'waits the long graceful-shutdown period (30 s in production) before SIGKILL')
    assert.deepEqual(k.st.signals.map(([, s]) => s), ['SIGTERM', 'SIGKILL'])
    assert.equal(k.st.alive, false)
    ok('a server ignoring SIGTERM is killed only after the long grace period')
  }
  {
    // Our own detached child (keep_alive_on_exit) in this dsh process: restart stops it.
    const mk = () => new HindsightService({
      config: cfg('manual', { mode: 'process', autostart: true, process: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] } }),
      logger: makeLogger('t'), runner,
      client: { calls: 0, async health() { this.calls += 1; return this.calls > 1 ? good : bad }, async version() { return {} } },
      procs: { pidFile: join(logDir, 'hindsight.pid'), minGraceMs: 3000 }
    })
    const s1 = mk()
    assert.equal(await s1.ensureReady('startup'), true)
    const child = s1.child
    assert.ok(child && child.pid)
    const exited = new Promise((r) => child.once('exit', r))
    await s1.stop({ restart: true })
    await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('child still running')), 5000))])
    ok('restart stops our own detached (keep-alive) child too')
    const s2 = mk()
    await s2.ensureReady('startup')
    const c2 = s2.child
    await s2.stop()
    let alive = true; try { process.kill(c2.pid, 0) } catch { alive = false }
    assert.equal(alive, true, 'plain stop leaves the kept-alive child running')
    try { process.kill(-c2.pid, 'SIGKILL') } catch { try { process.kill(c2.pid, 'SIGKILL') } catch { /* gone */ } }
    ok('plain stop keeps our detached child alive')
  }
  {
    // Wiring: the panel's 重启服务 / 重新部署 ask for a real restart; runtime passes it down.
    const { createRpcHandler } = await import('../lib/rpc.js')
    const calls = []
    const handler = createRpcHandler({ ctx: {}, current: () => ({}), reload: (o) => { calls.push(o) }, requestReinstall: () => {} })
    assert.equal((await handler('restart', {}, undefined, { principal: { kind: 'owner' } })).ok, true)
    assert.equal((await handler('redeploy', {}, undefined, { principal: { kind: 'owner' } })).ok, true)
    assert.deepEqual(calls, [{ restart: true }, { restart: true }])
    const { buildRuntime } = await import('./harness.mjs')
    const { runtime } = buildRuntime({})
    const seen = []
    runtime.service.stop = async (o) => { seen.push(o) }
    await runtime.shutdown({ restart: true })
    assert.deepEqual(seen, [{ restart: true }])
    ok('restart/redeploy RPC -> reload({ restart: true }) -> service.stop({ restart: true })')
  }
} finally { clearInterval(keep); rmSync(logDir, { recursive: true, force: true }) }
console.log(`\n${passed} passed`)
