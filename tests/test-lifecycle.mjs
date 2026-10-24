/**
 * Unit tests: service lifecycle with a fake runner and a fake health probe.
 * Run: node tests/test-lifecycle.mjs
 */
import assert from 'node:assert/strict'
import { HindsightService } from '../lib/lifecycle.js'
import { resolveConfig } from '../lib/config.js'
import { makeLogger } from './harness.mjs'

function cfg(overrides = {}) {
  return resolveConfig(
    {
      setup: 'manual',
      service: {
        base_url: 'http://127.0.0.1:18888',
        mode: 'auto',
        autostart: true,
        startup_timeout_ms: 3000,
        retry_interval_ms: 50,
        health_timeout_ms: 500,
        shutdown_grace_ms: 500,
        docker: { container: 'hindsight-test', image: 'ghcr.io/vectorize-io/hindsight:latest', port: 8888, cp_port: 9999 }
      },
      ...overrides
    },
    { env: {} }
  ).config
}

function fakeClient(healthPlan) {
  let call = 0
  return {
    healthCalls: [],
    ensured: new Set(),
    async health() {
      const index = Math.min(call, healthPlan.length - 1)
      const outcome = healthPlan[index]
      call += 1
      this.healthCalls.push(outcome.ok)
      return outcome
    },
    async version() {
      return { api_version: '1.1.0-fake' }
    },
    async ensureBank(id) {
      this.ensured.add(id)
      return { bankId: id }
    }
  }
}

const FAKE_RUNNER = (expected) => {
  const calls = []
  const envs = []
  return {
    calls,
    envs,
    run: async (command, args, options = {}) => {
      calls.push([command, ...args].join(' '))
      if (options.env) envs.push(options.env)
      for (const [pattern, response] of expected) {
        if (calls[calls.length - 1].includes(pattern)) return response
      }
      return { ok: true, code: 0, stdout: '', stderr: '' }
    }
  }
}

function serviceFor({ healthPlan, config, runner }) {
  const client = fakeClient(healthPlan)
  const service = new HindsightService({
    config,
    logger: makeLogger('lifecycle'),
    client,
    runner: runner ? runner.run : undefined
  })
  return { service, client }
}

const badHealth = { ok: false, status: 0, error: 'ECONNREFUSED' }
const goodHealth = { ok: true, status: 200, body: { status: 'healthy' } }

// 1. Server already up: attach, never start anything.
{
  const { service } = serviceFor({ healthPlan: [goodHealth], config: cfg({ service: { mode: 'auto' } }) })
  const ready = await service.ensureReady('test')
  assert.equal(ready, true)
  assert.equal(service.state, 'ready')
  assert.equal(service.launchMode, 'attach')
  assert.equal(service.startedByUs, false)
  await service.stop()
  console.log('PASS attach mode detects a running server and starts nothing')
}

// 2. Server down + autostart off: degrade, do not throw.
{
  const { service } = serviceFor({ healthPlan: [badHealth], config: cfg({ service: { mode: 'attach', autostart: false } }) })
  const ready = await service.ensureReady('test')
  assert.equal(ready, false)
  assert.equal(service.state, 'degraded')
  assert.match(service.lastError, /ECONNREFUSED/)
  await service.stop()
  console.log('PASS attach mode degrades gracefully when the server is down')
}

// 3. Docker autostart: inspect says stopped -> docker start -> health turns good.
{
  const runner = FAKE_RUNNER([
    ['docker version', { ok: true, code: 0, stdout: '27.0.0', stderr: '' }],
    ['docker inspect', { ok: true, code: 0, stdout: 'exited', stderr: '' }],
    ['docker start', { ok: true, code: 0, stdout: 'hindsight-test', stderr: '' }]
  ])
  const { service } = serviceFor({ healthPlan: [badHealth, badHealth, goodHealth, goodHealth], config: cfg(), runner })
  const ready = await service.ensureReady('test')
  assert.equal(ready, true)
  assert.equal(service.launchMode, 'docker')
  assert.equal(service.startedByUs, true)
  assert.ok(runner.calls.some((call) => call.includes('docker start hindsight-test')), runner.calls.join('\n'))
  await service.stop()
  assert.ok(
    runner.calls.some((call) => call.includes('docker stop')),
    `expected docker stop on shutdown, got:\n${runner.calls.join('\n')}`
  )
  console.log('PASS docker mode starts an existing container and stops it on shutdown')
}

// 4. keep_alive_on_exit: nothing is stopped.
{
  const runner = FAKE_RUNNER([
    ['docker version', { ok: true, code: 0, stdout: '27.0.0', stderr: '' }],
    ['docker inspect', { ok: true, code: 0, stdout: 'running', stderr: '' }]
  ])
  const { service } = serviceFor({ healthPlan: [badHealth, goodHealth, goodHealth], config: cfg({ service: { keep_alive_on_exit: true } }), runner })
  assert.equal(await service.ensureReady('test'), true)
  await service.stop()
  assert.equal(runner.calls.some((call) => call.includes('docker stop')), false)
  console.log('PASS keep_alive_on_exit leaves the container running')
}

// 5. docker mode, no container yet: docker run with ports and env.
{
  const runner = FAKE_RUNNER([
    ['docker version', { ok: true, code: 0, stdout: '27.0.0', stderr: '' }],
    ['docker inspect', { ok: false, code: 1, stdout: '', stderr: 'No such object' }],
    ['docker run', { ok: true, code: 0, stdout: '0123456789ab', stderr: '' }]
  ])
  const { service } = serviceFor({
    healthPlan: [badHealth, goodHealth, goodHealth],
    config: cfg({
      embedding: { provider: 'openai', base_url: 'http://emb/v1', model: 'bge-m3', dimensions: 1024 },
      service: { env_extra: { TZ: 'Asia/Shanghai' } }
    }),
    runner
  })
  assert.equal(await service.ensureReady('test'), true)
  const run = runner.calls.find((call) => call.includes('docker run'))
  assert.ok(run.includes('-p 127.0.0.1:8888:8888') && run.includes('-v hindsight-data:/home/hindsight/.pg0'), run)
  assert.ok(run.includes('-p 127.0.0.1:9999:9999'), run)
  assert.ok(run.includes('-e HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL'), run)
  assert.ok(run.includes('-e TZ'), run)
  // Values are handed to the docker CLI through its environment, never through argv.
  const runEnv = runner.envs.find((env) => env && env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL)
  assert.equal(runEnv?.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, 'bge-m3')
  assert.equal(runEnv?.TZ, 'Asia/Shanghai')
  assert.ok(run.endsWith('ghcr.io/vectorize-io/hindsight:latest'), run)
  await service.stop()
  console.log('PASS docker run is assembled from config (ports + env names, values via child env)')
}

// 6. compose mode.
{
  const runner = FAKE_RUNNER([
    ['compose -f', { ok: true, code: 0, stdout: 'started', stderr: '' }]
  ])
  const { service } = serviceFor({
    healthPlan: [badHealth, goodHealth, goodHealth],
    config: cfg({ service: { mode: 'compose', docker: { compose_file: '/srv/docker/hindsight/docker-compose.yml', compose_service: 'hindsight' } } }),
    runner
  })
  assert.equal(await service.ensureReady('test'), true)
  assert.ok(runner.calls.some((call) => call.includes('docker compose -f /srv/docker/hindsight/docker-compose.yml up -d hindsight')))
  await service.stop()
  assert.ok(runner.calls.some((call) => call.includes('compose -f') && call.includes('stop')))
  console.log('PASS compose mode launches and stops the declared service')
}

// 7. autostart failure degrades instead of throwing.
{
  const runner = FAKE_RUNNER([
    ['docker version', { ok: true, code: 0, stdout: '27.0.0', stderr: '' }],
    ['docker inspect', { ok: false, code: 1, stdout: '', stderr: 'No such object' }],
    ['docker run', { ok: false, code: 125, stdout: '', stderr: 'permission denied while trying to connect to the Docker daemon socket' }]
  ])
  const { service } = serviceFor({ healthPlan: [badHealth], config: cfg(), runner })
  assert.equal(await service.ensureReady('test'), false)
  assert.equal(service.state, 'degraded')
  assert.match(service.lastError, /docker run/)
  console.log('PASS failed autostart degrades with a warning instead of throwing')
}

// 8. startup timeout: container starts but never becomes healthy.
{
  const runner = FAKE_RUNNER([
    ['docker version', { ok: true, code: 0, stdout: '27.0.0', stderr: '' }],
    ['docker inspect', { ok: true, code: 0, stdout: 'exited', stderr: '' }],
    ['docker start', { ok: true, code: 0, stdout: 'hindsight-test', stderr: '' }]
  ])
  const { service } = serviceFor({
    healthPlan: [badHealth],
    config: cfg({ service: { startup_timeout_ms: 400, retry_interval_ms: 100 } }),
    runner
  })
  assert.equal(await service.ensureReady('test'), false)
  assert.equal(service.state, 'degraded')
  assert.match(service.lastError, /never became healthy/)
  console.log('PASS startup timeout degrades')
}

// 9. process mode: spawn a real child and stop it gracefully.
{
  const config = cfg({
    service: {
      mode: 'process',
      base_url: 'http://127.0.0.1:18888',
      autostart: true,
      health_timeout_ms: 300,
      startup_timeout_ms: 600,
      retry_interval_ms: 100,
      shutdown_grace_ms: 300,
      process: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], detached: false }
    }
  })
  const { service } = serviceFor({ healthPlan: [badHealth], config })
  const started = await service.start()
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.equal(started.mode, 'process')
  assert.ok(service.child && service.child.pid > 0, 'child process should be tracked')
  const pid = service.child.pid
  await service.stop()
  assert.equal(service.child, null, 'child reference is cleared after stop')
  assert.equal(isAlive(pid), false, `child ${pid} should be gone`)
  console.log('PASS process mode spawns and kills the child on shutdown')
}

// Secrets must never travel in argv, and an in-flight boot must not orphan a container.
{
  const runner = FAKE_RUNNER([
    ['docker version', { ok: true, code: 0, stdout: '27.0.0', stderr: '' }],
    ['docker inspect', { ok: false, code: 1, stdout: '', stderr: 'no such container' }],
    ['docker run', { ok: true, code: 0, stdout: 'sha256:deadbeef', stderr: '' }]
  ])
  const config = cfg({
    llm: { provider: 'openai', base_url: 'http://llm.local/v1', api_key: 'sk-super-secret', model: 'gpt-x' },
    embedding: { provider: 'openai', api_key: 'sk-embed-secret', model: 'emb' }
  })
  const { service } = serviceFor({ healthPlan: [badHealth, goodHealth], config, runner })
  const ready = await service.ensureReady('test')
  assert.equal(ready, true)
  const dockerRun = runner.calls.find((call) => call.startsWith('docker run'))
  assert.ok(dockerRun, runner.calls.join('\n'))
  assert.equal(dockerRun.includes('sk-super-secret'), false, 'api key must not appear in argv')
  assert.equal(dockerRun.includes('sk-embed-secret'), false, 'embedding key must not appear in argv')
  assert.ok(dockerRun.includes('-e HINDSIGHT_API_LLM_API_KEY'), 'env is passed by name only')
  assert.ok(dockerRun.includes('-e HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY'), dockerRun)
  const runEnv = runner.envs.find((env) => env && env.HINDSIGHT_API_LLM_API_KEY)
  assert.equal(runEnv?.HINDSIGHT_API_LLM_API_KEY, 'sk-super-secret', 'value travels in the child environment')
  assert.equal(runEnv?.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, 'sk-embed-secret')
  await service.stop()
  console.log('PASS docker autostart keeps secrets out of argv (env by name only)')
}

{
  // stop() must wait for an in-flight boot instead of returning early with startedByUs=false,
  // otherwise the freshly created container would be orphaned.
  const runner = FAKE_RUNNER([
    ['docker version', { ok: true, code: 0, stdout: '27.0.0', stderr: '' }],
    ['docker inspect', { ok: false, code: 1, stdout: '', stderr: 'none' }],
    ['docker run', { ok: true, code: 0, stdout: 'sha256:cafe', stderr: '' }]
  ])
  const { service, client } = serviceFor({
    healthPlan: [badHealth, goodHealth, goodHealth, goodHealth],
    config: cfg({ service: { startup_timeout_ms: 4000, retry_interval_ms: 60 } }),
    runner
  })
  client.health = async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
    return badHealth
  }
  const booting = service.ensureReady('test')
  await new Promise((resolve) => setTimeout(resolve, 120))
  await service.stop()
  const booted = await booting
  assert.equal(service.state, 'stopped')
  assert.equal(booted, false, 'a boot interrupted by shutdown reports failure instead of ready')
  assert.ok(
    runner.calls.some((call) => call.startsWith('docker stop')),
    `container must be stopped, got:\n${runner.calls.join('\n')}`
  )
  console.log('PASS stop() during startup reaps the container instead of orphaning it')
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

console.log('\nlifecycle tests passed')
