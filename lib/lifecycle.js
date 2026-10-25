/**
 * Hindsight service lifecycle: probe -> (optionally) start -> wait for health -> stop.
 *
 * Design constraints:
 *  - Activation must never block DSH startup, so `ensureReady()` is called without
 *    being awaited by the plugin factory; retain/recall simply skip while it is pending.
 *  - Any failure degrades to "no memory" and logs one warning. A broken memory
 *    backend must not cost the user a single token of the conversation flow.
 *  - The launcher is data: `attach` never spawns, `docker`/`compose`/`process`
 *    describe exactly one command each.
 */
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { serviceEnv } from './config.js'
import { proxyEnv } from './proxy.js'
/** Proxy choice for every Python child (set by the active Lifecycle). */
let PROXY_OPT = {}
// macOS GUI apps get PATH=/usr/bin:/bin:/usr/sbin:/sbin, hiding Homebrew python3.12 / uv.
if (process.platform === 'darwin') process.env.PATH = darwinPath(process.env.PATH, homedir())
const withProxy = (env) => proxyEnv(env, PROXY_OPT).env
import { HindsightClient } from './client.js'
import { planLocal, localVariant, localEnv } from './local.js'
import { ensureUv, uvPythonEnv } from './bootstrap.js'
import { dataRoot, dataEnv, darwinPath } from './dataroot.js'
import { syncDotenv, PLUGIN_ROOT } from './dotenv.js'
import { rotateFile, cleanupLogs } from './logfiles.js'
import { preflightEnv, summarizeEnv, logPath, tailFile, explainFailure, friendlyConnError, LOG_DIR } from './deploy.js'
import { expectedDim, probeEmbeddingDim, readRecordedDim, recordDim, compareDims } from './dimension.js'

/** PID of the Hindsight child we spawned last; lets a restarted dsh wait for a still-exiting old instance. */
export const PID_FILE = join(LOG_DIR, 'hindsight.pid')

export function pidAlive(pid) {
  pid = Number(pid)
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0) } catch (e) { if (e.code !== 'EPERM') return false }
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    return /hindsight|uv|python/i.test(cmd)
  } catch { return process.platform !== 'linux' }
}

/**
 * The old instance does a ~30s graceful shutdown and then stops pg0; starting a new one meanwhile
 * makes the old shutdown kill the new database ("Database migration failed"). Wait for it.
 */
export async function waitPreviousInstance({ pidFile = PID_FILE, timeoutMs = 60000, onWait, alive = pidAlive, sleepMs = 500 } = {}) {
  let pid
  try { pid = Number(readFileSync(pidFile, 'utf8').trim()) } catch { return { waited: false } }
  const t0 = Date.now()
  while (alive(pid)) {
    if (Date.now() - t0 > timeoutMs) return { waited: true, timedOut: true, pid }
    if (onWait) onWait(Math.round((Date.now() - t0) / 1000), pid)
    await new Promise((r) => setTimeout(r, sleepMs))
  }
  try { unlinkSync(pidFile) } catch { /* gone */ }
  return { waited: Date.now() - t0 > 0, timedOut: false, pid }
}

/** Set by the panel's "redeploy" action; consumed by the next venv install. */
let reinstallRequested = false
export function requestReinstall() { reinstallRequested = true }

/** Python must write UTF-8 regardless of the Windows ANSI code page (GBK on zh-CN). */
const PY_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }

/**
 * Streamed runner for long installs: output is appended to `logFile` as it arrives (no
 * maxBuffer limit, visible while running) and each line is reported through `onLine`.
 */
export function runStreamed(command, args, { env, cwd, timeoutMs = 1800000, logFile, onLine = () => {} } = {}) {
  return new Promise((resolve) => {
    let tail = ''
    let child
    const write = (text) => { if (logFile) try { appendFileSync(logFile, text) } catch { /* ignore */ } }
    write(`\n[${new Date().toISOString()}] $ ${command} ${args.join(' ')}\n`)
    try {
      child = spawn(command, args, { env: withProxy({ ...process.env, ...PY_ENV, ...(env || {}) }), cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      write(`spawn failed: ${error.message}\n`)
      return resolve({ ok: false, code: -1, stdout: '', stderr: error.message })
    }
    const timer = setTimeout(() => { write('timeout, killing\n'); try { child.kill() } catch { /* gone */ } }, timeoutMs)
    const onData = (buf) => {
      const text = buf.toString('utf8')
      write(text)
      tail = (tail + text).slice(-8000)
      for (const line of text.split(/\r?\n|\r/)) if (line.trim()) onLine(line.trim())
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => { clearTimeout(timer); write(`error: ${error.message}\n`); resolve({ ok: false, code: -1, stdout: '', stderr: `${error.message}` }) })
    child.on('close', (code) => { clearTimeout(timer); write(`[exit ${code}]\n`); resolve({ ok: code === 0, code, stdout: tail, stderr: tail }) })
  })
}

function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host })
    sock.setTimeout(1500)
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('timeout', () => { sock.destroy(); resolve(false) })
    sock.once('error', () => resolve(false))
  })
}

const STEP_IDS = ['config', 'python', 'install', 'start', 'health']

/** Runs a command and resolves `{ ok, code, stdout, stderr }`; never rejects. */
export function createRunner() {
  return function run(command, args = [], options = {}) {
    return new Promise((resolve) => {
      const child = execFile(
        command,
        args,
        {
          timeout: options.timeoutMs || 20000,
          cwd: options.cwd || undefined,
          env: options.env ? { ...process.env, ...options.env } : process.env,
          maxBuffer: 8 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          resolve({
            ok: !error,
            code: error?.code ?? 0,
            stdout: String(stdout || ''),
            stderr: String(stderr || error?.message || '')
          })
        }
      )
      child.on('error', (error) => {
        resolve({ ok: false, code: -1, stdout: '', stderr: error.message })
      })
    })
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class HindsightService {
  /**
   * @param {{ config: object, logger: object, runner?: Function, client?: HindsightClient }} args
   */
  constructor({ config, logger, runner, client }) {
    this.config = config
    PROXY_OPT = config.service?.proxy || {}
    this.logger = logger
    this.run = runner || createRunner()
    this.client = client || new HindsightClient({
      baseUrl: config.service.base_url,
      apiPrefix: config.service.api_prefix,
      apiKey: config.service.api_key,
      timeoutMs: config.service.request_timeout_ms,
      healthPath: config.service.health_path,
      versionPath: config.service.version_path,
      logger
    })
    /** @type {'idle'|'starting'|'ready'|'degraded'|'stopped'} */
    this.state = 'idle'
    this.launchMode = ''
    this.startedByUs = false
    this.child = null
    this.childLog = null
    this.health = null
    this.version = null
    this.lastError = ''
    this.pending = null
    /** Set as soon as stop() begins so an in-flight boot can bail out instead of racing it. */
    this.stopping = false
    this.retryDelay = 0
    this.lastWarn = ''
    /** Live deployment progress for the panel (setup=local). */
    this.deploy = { steps: STEP_IDS.map((id) => ({ id, status: 'pending', detail: '' })), logDir: LOG_DIR, port: Number(config.service.local?.port) || 8888, pid: null, error: '', hint: '', tail: [], config: '', startedAt: null }
  }

  #step(id, status, detail = '') {
    const step = this.deploy.steps.find((s) => s.id === id)
    if (step) Object.assign(step, { status, detail: String(detail).slice(0, 300), at: new Date().toISOString() })
  }

  #fail(id, error, text = '') {
    this.#step(id, 'failed', error)
    this.deploy.error = error
    this.deploy.hint = explainFailure(`${error}\n${text}`)
    return { ok: false, mode: 'local', error: this.deploy.hint ? `${error} — ${this.deploy.hint.split('\n')[0]}` : error }
  }

  /** Warn once per distinct message; repeats go to debug (no log spam on retries). */
  #warn(message) {
    if (message === this.lastWarn) this.logger.debug(message)
    else this.logger.warn(message)
    this.lastWarn = message
  }

  get ready() {
    return this.state === 'ready'
  }

  get baseUrl() {
    return this.config.service.base_url
  }

  /** Single-flight: concurrent callers share one attempt. */
  /**
   * Re-probe a degraded backend at most every `retry_degraded_ms`: a slow first image pull
   * or a server started after DSH must not disable memory for the whole session.
   */
  maybeRetry(reason = 'retry') {
    if (this.state !== 'degraded' || this.pending || this.stopping) return
    if (this.config.setup === 'unset' && this.config.service.mode === 'auto') return // nothing to retry until the user finishes setup
    const base = Math.max(5000, Number(this.config.service.retry_degraded_ms) || 30000)
    const every = this.retryDelay || base
    if (Date.now() - (this.lastAttemptAt || 0) < every) return
    // Exponential backoff for repeated failures: 30s, 60s, 120s ... capped at 10 min.
    // An existing server is cheap to probe: never wait more than a minute between checks.
    this.retryDelay = Math.min(this.config.setup === 'existing' ? 60000 : 600000, every * 2)
    void this.ensureReady(reason).catch(() => false)
  }

  /**
   * A request failed while we thought the server was up (stopped mid-session, wrong key, ...).
   * Flip to degraded so writes wait instead of being dropped; the runtime's catch-up loop
   * re-probes and, once healthy again, re-sends everything after the per-session cursor.
   */
  markUnreachable(error) {
    const st = Number(error?.status) || 0
    if (this.state !== 'ready' || this.stopping) return false
    if (st && st < 500 && st !== 401 && st !== 403 && st !== 408) return false // a bad request, not an outage
    this.state = 'degraded'
    this.lastError = friendlyConnError(error, this.baseUrl) || String(error?.message || error)
    this.retryDelay = 0
    const base = Math.max(5000, Number(this.config.service.retry_degraded_ms) || 30000)
    this.lastAttemptAt = Date.now() - base + 5000 // first re-probe in ~5s
    this.#warn(`Hindsight became unreachable at ${this.baseUrl}: ${this.lastError}`)
    return true
  }

  ensureReady(reason = 'startup') {
    if (this.stopping || this.state === 'stopped') return Promise.resolve(false)
    this.lastAttemptAt = Date.now()
    if (this.state === 'ready') return Promise.resolve(true)
    if (this.pending) return this.pending
    this.pending = this.#boot(reason).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async #boot(reason) {
    const svc = this.config.service
    this.state = 'starting'
    const probe = await this.client.health({ timeoutMs: svc.health_timeout_ms })
    if (this.stopping) return false
    if (!probe.ok && this.startedByUs && reason !== 'startup') {
      // We already launched it once; just keep waiting for health instead of re-launching.
      const healthy = await this.waitHealthy(svc.startup_timeout_ms)
      if (healthy && !this.stopping) {
        this.state = 'ready'
        await this.#describe()
        this.logger.info(`Hindsight became ready at ${this.baseUrl} (${reason})`)
        return true
      }
      this.state = 'degraded'
      return false
    }
    if (probe.ok && this.config.setup === 'existing') {
      // /health needs no auth: check the key against a real endpoint before declaring ready.
      try { await this.client.listBanks() } catch (error) {
        const st = Number(error?.status) || 0
        if (st === 401 || st === 403) {
          this.state = 'degraded'
          this.lastError = friendlyConnError(error, this.baseUrl)
          this.#warn(`Hindsight at ${this.baseUrl} rejected the API key (${st}); running without long-term memory`)
          return false
        }
      }
    }
    if (probe.ok) {
      this.state = 'ready'
      this.retryDelay = 0
      this.lastWarn = ''
      this.launchMode = 'attach'
      await this.#describe()
      this.logger.info(`Hindsight attached at ${this.baseUrl} (${reason})`)
      return true
    }

    if (this.config.setup === 'unset' && (svc.mode === 'auto' || !svc.mode)) {
      this.state = 'degraded'
      this.lastError = '尚未完成首次设置：请在 dsh「插件 → dsh-hindsight-memory」面板选择「已配置 Hindsight」或「本地部署」'
      this.#warn(`Hindsight not set up yet (no server at ${this.baseUrl}); open the plugin panel to choose "existing" or "local". Not starting anything.`)
      return false
    }
    if (!svc.autostart || svc.mode === 'attach') {
      this.state = 'degraded'
      const raw = probe.error || `health returned ${probe.status}`
      const hint = friendlyConnError({ status: probe.status, message: probe.error }, this.baseUrl)
      this.lastError = hint ? `${hint}（${raw}）` : raw
      this.#warn(
        `Hindsight not reachable at ${this.baseUrl} (${this.lastError}); ` +
          `running without long-term memory (autostart=${svc.autostart}, mode=${svc.mode})`
      )
      return false
    }

    this.logger.info(`Hindsight unreachable at ${this.baseUrl}, starting it (reason: ${reason})`)
    const started = await this.start()
    if (this.stopping) return false
    if (!started.ok) {
      this.state = 'degraded'
      this.lastError = started.error
      this.#warn(`Hindsight autostart failed: ${started.error}; continuing without memory`)
      return false
    }
    this.#step('health', 'running', `等待 ${this.baseUrl}/health`)

    const healthy = await this.waitHealthy(svc.startup_timeout_ms)
    if (this.stopping) return false
    if (!healthy) {
      this.state = 'degraded'
      if (this.childExit) {
        this.lastError = `Hindsight 进程已退出 (code=${this.childExit.code})${this.deploy.hint ? '：' + this.deploy.hint.split('\n')[0] : ''}`
        this.#step('health', 'failed', this.lastError)
      } else {
        this.lastError = `server never became healthy within ${svc.startup_timeout_ms}ms`
        this.#step('health', 'failed', `超时：${svc.startup_timeout_ms}ms 内 /health 未就绪`)
      }
      this.deploy.error = this.lastError
      this.#warn(`Hindsight started but never became healthy: ${this.lastError}; continuing without memory`)
      return false
    }
    if (this.stopping) return false
    this.#step('health', 'done', '/health 正常')
    // The server accepted this dimension against its database: remember it for the next start.
    if (this.dimInfo && this.launchMode === 'process') recordDim(this.dimInfo.dbUrl, { dim: this.dimInfo.dim, model: this.dimInfo.model })
    this.retryDelay = 0
    this.lastWarn = ''
    this.state = 'ready'
    await this.#describe()
    this.logger.info(`Hindsight ready at ${this.baseUrl} (mode=${this.launchMode})`)
    return true
  }

  async #describe() {
    this.version = await this.client.version({ timeoutMs: this.config.service.request_timeout_ms })
    const apiVersion = this.version?.api_version
    if (apiVersion) this.logger.info(`Hindsight api_version=${apiVersion}`)
    return this.version
  }

  async waitHealthy(totalMs) {
    const svc = this.config.service
    const deadline = Date.now() + Math.max(1000, totalMs)
    while (Date.now() < deadline) {
      if (this.stopping) return false
      // Our child died: no point waiting out the whole startup timeout.
      if (this.launchMode === 'process' && this.startedByUs && this.childExit && !this.child) return false
      const probe = await this.client.health({ timeoutMs: svc.health_timeout_ms })
      if (probe.ok) {
        this.health = probe.body
        return true
      }
      await sleep(Math.max(200, svc.retry_interval_ms))
    }
    return false
  }

  async #detectMode() {
    const dockerOk = (await this.run('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 8000 }))
    const dockerAvailable = dockerOk.ok
    const svc = this.config.service
    if (dockerAvailable) {
      const inspect = await this.run('docker', ['inspect', '-f', '{{.State.Status}}', svc.docker.container], {
        timeoutMs: 8000
      })
      if (inspect.ok) return 'docker'
    }
    if (svc.process.command) return 'process'
    if (dockerAvailable && svc.docker.compose_file) return 'compose'
    if (dockerAvailable && svc.docker.image) return 'docker'
    return 'attach'
  }

  /** @returns {Promise<{ ok: boolean, mode: string, error?: string, detail?: string }>} */
  async start() {
    const svc = this.config.service
    let mode = svc.mode
    if (mode === 'auto') mode = await this.#detectMode()
    this.launchMode = mode
    try {
      if (mode === 'local') return await this.#startLocal()
      if (mode === 'docker') return await this.#startDocker()
      if (mode === 'compose') return await this.#startCompose()
      if (mode === 'process') return await this.#startProcess()
      return { ok: false, mode, error: `mode "${mode}" cannot start a server (attach only)` }
    } catch (error) {
      return { ok: false, mode, error: error?.message || String(error) }
    }
  }

  /** "未配置" branch: plan uvx / pip / docker for this OS, then reuse the process/docker launchers. */
  async #startLocal() {
    const d = this.deploy
    d.startedAt = new Date().toISOString()
    d.error = ''
    d.hint = ''
    const variant = localVariant(this.config)
    const dot = this.#localEnvFile()
    d.dotenv = dot.path
    if (dot.error) this.logger.warn(`could not write ${dot.path}: ${dot.error}`)
    else this.logger.info(`local Hindsight env file ${dot.path}${dot.written ? ' (updated from panel config)' : ''}: ${summarizeEnv(dot.env)}`)
    const pre = preflightEnv(dot.env, { variant })
    d.warnings = pre.warnings
    for (const w of pre.warnings) this.logger.warn(`local Hindsight: ${w}`)
    if (!pre.ok) {
      for (const e of pre.errors) this.#warn(`local Hindsight 未启动：${e}`)
      const r = this.#fail('config', pre.errors.join('\n'))
      d.hint = pre.errors.join('\n')
      return { ...r, error: `配置不完整，未启动本地 Hindsight：${pre.errors[0]}` }
    }
    const dim = await this.#checkDimension(dot.env)
    if (!dim.ok) {
      for (const e of dim.errors) this.#warn(`local Hindsight 未启动：${e}`)
      const r = this.#fail('config', dim.errors.join('\n'))
      d.hint = dim.errors.join('\n')
      return { ...r, error: dim.errors[0] }
    }
    this.#step('config', 'done', `variant=${variant} · 向量维度 ${dim.dim}${dim.probed ? '（已用模型实测）' : ''}`)
    await waitPreviousInstance({ onWait: (sec) => this.#step('start', 'running', `等待上一次的记忆服务退出（${sec} 秒）`) })
    if (await portInUse(d.port)) {
      return this.#fail('start', `端口 ${d.port} 已被其他程序占用（不是 Hindsight：/health 无响应）`, 'address already in use')
    }
    this.#step('python', 'running', '查找 Python 3.11+ / uv / Docker')
    const has = async (cmd) => (await this.run(cmd, cmd === 'docker' ? ['version', '--format', '{{.Server.Version}}'] : ['--version'], { timeoutMs: 15000 })).ok
    const pyOk = async (cand) => {
      const [cmd, ...pre] = cand
      const r = await this.run(cmd, [...pre, '-c', 'import sys; print(int(sys.version_info >= (3, 11)))'], { timeoutMs: 15000 })
      return r.ok && r.stdout.trim() === '1'
    }
    const python = async (cands) => {
      for (const cand of cands) if (await pyOk(cand)) return cand
      if (this.config.service.local?.auto_bootstrap === false) return null
      return this.#bootstrapPython(has, pyOk)
    }
    const plan = await planLocal(this.config, { platform: process.platform, has, python })
    this.localPlan = plan
    if (plan.kind === 'none') return this.#fail('python', plan.reason, 'ENOENT')
    this.#step('python', 'done', plan.basePython ? `${plan.runner}: ${plan.basePython.join(' ')}` : plan.runner)
    this.logger.info(`local Hindsight via ${plan.runner} (${plan.variant}${plan.command ? `: ${plan.command} ${plan.args.join(' ')}` : `: ${plan.image}`})`)
    this.extraEnv = plan.env
    const svc = this.config.service
    const dr = dataRoot(this.config)
    if (dr.note) this.logger.info(dr.note)
    if (dr.relocated && plan.kind !== 'docker') {
      for (const d of [dr.root, dr.childHome, join(dr.root, 'tmp')].filter(Boolean)) {
        try { mkdirSync(d, { recursive: true }) } catch (error) {
          return this.#fail('python', `无法创建数据目录 ${d}（${error.message}）。请在高级设置「数据目录」填一个纯英文、可写的路径，例如 D:\\dsh-hindsight`, error.code)
        }
      }
    }
    if (plan.kind === 'docker') {
      // The image brings its own database; pg0 is only for the pip/uvx process.
      const { HINDSIGHT_API_DATABASE_URL: _db, ...rest } = plan.env
      // Host paths (data root, HOME/USERPROFILE, caches) mean nothing inside the container.
      for (const k of ['HOME', 'USERPROFILE', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'UV_TOOL_DIR', 'PIP_CACHE_DIR', 'HF_HOME', 'TMP', 'TEMP', 'TMPDIR']) delete rest[k]
      this.extraEnv = rest
      svc.docker = { ...svc.docker, image: plan.image, port: plan.port }
      this.launchMode = 'docker'
      return await this.#startDocker()
    }
    if (plan.kind === 'venv') {
      const installed = await this.#ensureVenv(plan)
      if (!installed.ok) return this.#fail('install', installed.error, installed.log)
      this.#step('install', 'done', plan.pkg)
    } else {
      this.#step('install', 'done', plan.runner === 'uvx' ? 'uvx 首次运行时下载（日志见 hindsight.log）' : plan.runner)
    }
    const local = svc.local || {}
    if (plan.runner === 'uvx' && local.pip_index_url) this.extraEnv = { ...this.extraEnv, UV_INDEX_URL: local.pip_index_url, UV_DEFAULT_INDEX: local.pip_index_url }
    svc.process = { ...svc.process, command: plan.command, args: plan.args, cwd: svc.process?.cwd || (dr.relocated ? dr.root : PLUGIN_ROOT) }
    this.launchMode = 'process'
    this.#step('start', 'running', `${plan.command} ${plan.args.join(' ')}`)
    const started = await this.#startProcess()
    if (started.ok) this.#step('start', 'done', `PID ${this.child?.pid}`)
    else return this.#fail('start', started.error)
    if (started.ok && svc.local?.control_plane?.enabled) this.startControlPlane()
    return started
  }

  /** Command line for the official Control Plane (npx; Node 20+). */
  controlPlanePlan(platform = process.platform) {
    const cp = this.config.service.local?.control_plane || {}
    const port = Number(cp.port) || 9999
    const pkg = `@vectorize-io/hindsight-control-plane@${cp.version || '1.1.0'}`
    return {
      command: platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['-y', pkg, '--port', String(port), '--hostname', '127.0.0.1', '--api-url', this.config.service.base_url],
      url: `http://127.0.0.1:${port}`,
      shell: platform === 'win32'
    }
  }

  startControlPlane() {
    if (this.cpChild) return
    const plan = this.controlPlanePlan()
    this.controlPlaneUrl = plan.url
    try {
      const child = spawn(plan.command, plan.args, {
        env: { ...process.env, HINDSIGHT_CP_DATAPLANE_API_URL: this.config.service.base_url },
        stdio: 'ignore',
        shell: plan.shell,
        detached: process.platform !== 'win32',
        windowsHide: true
      })
      child.on('error', (error) => this.logger.warn(`control plane: ${error.message}`))
      child.on('exit', () => { if (this.cpChild === child) this.cpChild = null })
      this.cpChild = child
      this.logger.info(`Hindsight Control Plane starting at ${plan.url}`)
    } catch (error) {
      this.logger.warn(`control plane spawn failed: ${error.message}`)
    }
  }

  async stopControlPlane() {
    const child = this.cpChild
    this.cpChild = null
    if (!child?.pid) return
    // npx spawns node -> next server: stop the whole tree.
    if (process.platform === 'win32') await this.run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeoutMs: 10000 })
    else { try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* gone */ } } }
  }

  /** Create the private venv and pip-install the pinned package once (marker = package spec). */
  /** No usable Python: fetch the standalone uv binary, then let uv download Python 3.12. */
  async #bootstrapPython(has, pyOk) {
    const indexUrl = this.config.service.local?.pip_index_url || ''
    const installLog = logPath('install.log'); try { rotateFile(installLog) } catch { /* best effort */ }
    try {
      this.#step('python', 'running', '电脑上没有合适的 Python，正在自动准备（只需一次）')
      const dr = dataRoot(this.config)
      const { uv } = await ensureUv({ has, indexUrl, toolsDir: dr.relocated ? join(dr.root, 'bin') : undefined, onProgress: (m) => this.#step('python', 'running', m) })
      const env = withProxy({ ...process.env, ...this.#installEnv(), ...uvPythonEnv(indexUrl, dr.root) })
      const ver = String(this.config.service.local?.python || '3.12')
      this.#step('python', 'running', `正在下载 Python ${ver}（约 30 MB）`)
      const inst = await runStreamed(uv, ['python', 'install', ver], { env, timeoutMs: 900000, logFile: installLog })
      if (!inst.ok) throw new Error(`uv python install 失败: ${(inst.stderr || '').trim().slice(-300)}`)
      const found = await runStreamed(uv, ['python', 'find', ver], { env, timeoutMs: 60000, logFile: installLog })
      const path = (found.stdout || '').trim().split(/\r?\n/).pop()
      if (!found.ok || !path || !(await pyOk([path]))) throw new Error('Python 下载完成但无法运行')
      this.logger.info(`bootstrapped Python via uv: ${path}`)
      return [path]
    } catch (error) {
      this.logger.warn(`自动准备 Python 失败: ${error.message}`)
      return null
    }
  }

  /** uv/pip/venv env: caches + TEMP under the data root, but keep the user's HOME so their pip.ini still applies. */
  #installEnv() {
    const dr = dataRoot(this.config)
    const { HOME: _h, USERPROFILE: _u, ...env } = dataEnv(dr)
    if (dr.relocated) { try { mkdirSync(join(dr.root, 'tmp'), { recursive: true }) } catch { /* reported at launch */ } }
    return env
  }

  async #ensureVenv(plan) {
    if (reinstallRequested) {
      reinstallRequested = false
      try { unlinkSync(plan.marker) } catch { /* not installed yet */ }
    }
    try {
      if (existsSync(plan.server) && existsSync(plan.marker) && readFileSync(plan.marker, 'utf8').trim() === plan.pkg) return { ok: true }
    } catch { /* reinstall */ }
    const installLog = logPath('install.log'); try { rotateFile(installLog) } catch { /* best effort */ }
    this.deploy.installLog = installLog
    const timeoutMs = Number(this.config.service.local?.install_timeout_ms) || 1800000
    if (!existsSync(plan.python)) {
      this.logger.info(`creating venv ${plan.venv}`)
      const [cmd, ...pre] = plan.basePython
      mkdirSync(dirname(plan.venv), { recursive: true })
      this.#step('install', 'running', `创建 venv ${plan.venv}`)
      const made = await runStreamed(cmd, [...pre, '-m', 'venv', plan.venv], { env: this.#installEnv(), timeoutMs: 300000, logFile: installLog })
      if (!made.ok) return { ok: false, error: `python -m venv 失败: ${made.stderr.trim().slice(-400)}`, log: made.stderr }
    }
    const local = this.config.service.local || {}
    const index = local.pip_index_url ? ['-i', local.pip_index_url] : []
    const extra = Array.isArray(local.pip_extra_args) ? local.pip_extra_args.map(String) : []
    this.logger.info(`pip install ${plan.pkg}${index.length ? ` (index ${local.pip_index_url})` : ''} (first run downloads ~100-200 MB; log: ${installLog})`)
    this.#step('install', 'running', `pip install ${plan.pkg}`)
    let count = 0
    const pip = await runStreamed(plan.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...index, ...extra, plan.pkg], {
      env: this.#installEnv(),
      timeoutMs,
      logFile: installLog,
      onLine: (line) => {
        if (/^(Collecting|Downloading|Installing|Successfully|Building|Using cached)/.test(line)) {
          if (/^Collecting/.test(line)) count++
          this.#step('install', 'running', `[${count} 个包] ${line}`)
        }
      }
    })
    if (!pip.ok) return { ok: false, error: `pip install 失败 (exit ${pip.code})：${pip.stderr.trim().split(/\r?\n/).slice(-3).join(' | ').slice(-400)}`, log: pip.stderr }
    try { writeFileSync(plan.marker, plan.pkg + '\n') } catch { /* next start reinstalls (no-op) */ }
    return { ok: true }
  }

  #launchEnv() {
    const svc = this.config.service
    const env = { ...serviceEnv(this.config, this.logger), ...(this.extraEnv || {}) }
    for (const [key, value] of Object.entries(svc.docker.extra_env || {})) env[key] = String(value)
    for (const [key, value] of Object.entries(svc.process.env || {})) env[key] = String(value)
    // setup=local: the plugin-root .env is authoritative (merged with the panel config).
    if (this.config.setup === 'local' || svc.mode === 'local') return { ...env, ...this.#localEnvFile().env }
    return env
  }

  /** Sync panel config → <plugin>/.env and return the effective HINDSIGHT_* variables. */
  /**
   * Expected (.env / panel) vs the model's real output vs what this database was created with.
   * Blocks the launch on any mismatch so no vector of the wrong size is ever written.
   */
  async #checkDimension(env) {
    const expected = expectedDim(env, this.config)
    const dbUrl = env.HINDSIGHT_API_DATABASE_URL || 'pg0://dsh-hindsight'
    let probed = null
    if (this.config.service.local?.dim_probe !== false) {
      const p = await probeEmbeddingDim({
        provider: env.HINDSIGHT_API_EMBEDDINGS_PROVIDER,
        baseUrl: env.HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL,
        apiKey: env.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY,
        model: env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL,
        dimensions: env.HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS,
        fetchImpl: this.fetchImpl || fetch
      })
      probed = p.dim
      if (!p.dim && p.reason !== 'unsupported') this.logger.info(`embedding dimension probe skipped: ${p.reason}`)
    }
    const recorded = readRecordedDim(dbUrl)
    const errors = compareDims({ expected, probed, recorded, model: env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL })
    this.dimInfo = { dbUrl, dim: probed || expected, model: env.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL || '' }
    return { ok: errors.length === 0, errors, dim: probed || expected, probed: !!probed }
  }

  #localEnvFile() {
    const svc = this.config.service
    const generated = { ...serviceEnv(this.config), ...localEnv(this.config), ...(svc.process.env || {}) }
    generated.HINDSIGHT_API_PORT = String(Number(svc.local?.port) || 8888)
    if (svc.local?.pip_index_url) generated.UV_INDEX_URL = svc.local.pip_index_url
    // A key resolved from dsh's credential store (llm.mode=follow) is injected, never persisted.
    const transient = this.config.llm?.mode === 'follow' && this.config.llm.api_key ? { HINDSIGHT_API_LLM_API_KEY: this.config.llm.api_key } : {}
    const mode = this.config.llm?.mode
    // localEnv() maps "no LLM" to provider none; only persist that for an explicit choice,
    // otherwise it would clobber a provider/key the user wrote into .env by hand.
    if (generated.HINDSIGHT_API_LLM_PROVIDER === 'none' && mode !== 'none') delete generated.HINDSIGHT_API_LLM_PROVIDER
    const r = syncDotenv(generated, { transient })
    if (mode === 'none') r.env.HINDSIGHT_API_LLM_PROVIDER = 'none'
    else if (mode === 'follow') {
      const lp = String(r.env.HINDSIGHT_API_LLM_PROVIDER || '').toLowerCase()
      if (!lp || (!r.env.HINDSIGHT_API_LLM_API_KEY && !['none', 'ollama', 'lmstudio', 'llamacpp'].includes(lp))) {
        // Could not follow dsh and .env has no usable LLM: documented fallback = chunks only.
        r.env.HINDSIGHT_API_LLM_PROVIDER = 'none'
        r.llmFallback = true
      }
    }
    return r
  }

  async #startDocker() {
    const d = this.config.service.docker
    const env = this.#launchEnv()
    const status = await this.run('docker', ['inspect', '-f', '{{.State.Status}}', d.container], { timeoutMs: 8000 })
    if (status.ok) {
      const current = status.stdout.trim()
      if (current === 'running') {
        this.startedByUs = false
        return { ok: true, mode: 'docker', detail: 'already running' }
      }
      // NOTE: an existing container keeps the env it was created with; embedding/reranker/llm
      // changes in config need `docker rm hindsight` first (data survives in the volume).
      this.logger.info(`reusing existing container ${d.container}; config changes to model env need a docker rm to apply`)
      const start = await this.run('docker', ['start', d.container], { timeoutMs: 60000 })
      if (!start.ok) return { ok: false, mode: 'docker', error: `docker start: ${start.stderr.trim()}` }
      this.startedByUs = true
      return { ok: true, mode: 'docker', detail: 'started existing container' }
    }

    const args = ['run', '-d', '--name', d.container, '--restart', d.restart_policy]
    if (d.network) args.push('--network', d.network)
    // Bind to loopback only: Hindsight has no auth by default, and `-p 8888:8888` would
    // publish every stored conversation to the LAN.
    const host = d.bind_host ? `${d.bind_host}:` : ''
    args.push('-p', `${host}${d.port}:8888`)
    if (d.cp_port) args.push('-p', `${host}${d.cp_port}:9999`)
    // Persist the embedded Postgres (docs: -v hindsight-data:/home/hindsight/.pg0). Without
    // it every `docker rm` / image upgrade wipes all memories.
    if (d.volume) args.push('-v', `${d.volume}:/home/hindsight/.pg0`)
    if (d.shm_size) args.push('--shm-size', String(d.shm_size))
    // `-e KEY` (name only) makes the docker CLI read the value from its own environment, so
    // secrets never land in argv (/proc/<pid>/cmdline is world-readable on a shared host).
    for (const key of Object.keys(env)) args.push('-e', key)
    for (const extra of d.extra_args || []) args.push(String(extra))
    args.push(d.image)

    this.logger.info(`docker ${args.join(' ')}`)
    // First run pulls a multi-GB image; 120 s was routinely too short.
    const created = await this.run('docker', args, { timeoutMs: Math.max(120000, Number(d.run_timeout_ms) || 900000), env })
    if (!created.ok) return { ok: false, mode: 'docker', error: `docker run: ${created.stderr.trim()}` }
    this.startedByUs = true
    return { ok: true, mode: 'docker', detail: `created container ${created.stdout.trim().slice(0, 12)}` }
  }

  async #startCompose() {
    const d = this.config.service.docker
    if (!d.compose_file) return { ok: false, mode: 'compose', error: 'docker.compose_file is empty' }
    const args = ['compose', '-f', d.compose_file, 'up', '-d']
    if (d.compose_service) args.push(d.compose_service)
    const res = await this.run('docker', args, { timeoutMs: 180000, cwd: dirname(d.compose_file) })
    if (!res.ok) return { ok: false, mode: 'compose', error: `docker compose up: ${res.stderr.trim()}` }
    this.startedByUs = true
    return { ok: true, mode: 'compose', detail: res.stdout.trim().slice(0, 200) }
  }

  async #startProcess() {
    const p = this.config.service.process
    if (!p.command) return { ok: false, mode: 'process', error: 'process.command is empty' }
    // process.env is merged first (PATH, SystemRoot, APPDATA... are required on Windows),
    // then the plugin's HINDSIGHT_* variables override anything inherited.
    const launchEnv = this.#launchEnv()
    const px = proxyEnv({ ...process.env, ...PY_ENV, ...launchEnv }, PROXY_OPT)
    const env = px.env
    this.logger.info(`Hindsight network: ${px.summary}${px.dropped.length ? `; dropped NO_PROXY entries httpx cannot parse: ${px.dropped.join(' ')}` : ''}`)
    this.deploy.config = summarizeEnv(launchEnv)
    this.logger.info(`Hindsight config: ${this.deploy.config}`)
    const detached = Boolean(p.detached || this.config.service.keep_alive_on_exit)
    let out = 'ignore'
    const logFile = logPath('hindsight.log')
    this.deploy.serverLog = logFile
    try { rotateFile(logFile); cleanupLogs(LOG_DIR) } catch { /* housekeeping is best effort */ }
    clearInterval(this.logRotateTimer)
    this.logRotateTimer = setInterval(() => { try { if (rotateFile(logFile)) { this.logOffset = 0; cleanupLogs(LOG_DIR) } } catch { /* ignore */ } }, 60000)
    this.logRotateTimer.unref?.()
    try {
      this.logOffset = existsSync(logFile) ? statSync(logFile).size : 0
      appendFileSync(logFile, `\n[${new Date().toISOString()}] $ ${p.command} ${(p.args || []).join(' ')}\n[config] ${this.deploy.config}\n`)
      this.logOffset = statSync(logFile).size
      // spawn() needs a file descriptor, not a stream, for redirected stdio.
      this.childLog = openSync(logFile, 'a')
      out = this.childLog
    } catch {
      this.childLog = null
    }
    if (p.cwd) try { mkdirSync(p.cwd, { recursive: true }) } catch { /* spawn reports it */ }
    this.childExit = null
    let child
    try {
      child = spawn(p.command, (p.args || []).map(String), {
        cwd: p.cwd || undefined,
        env,
        detached,
        windowsHide: true,
        stdio: ['ignore', out, out]
      })
    } catch (error) {
      return { ok: false, mode: 'process', error: `spawn ${p.command} 失败: ${error.message}` }
    }
    child.on('error', (error) => {
      this.lastError = `spawn failed: ${error.message}`
      this.childExit = { code: -1, signal: null }
      this.deploy.hint = explainFailure(`ENOENT ${error.message}`)
      this.#warn(this.lastError)
    })
    child.on('exit', (code, signal) => {
      try { if (readFileSync(PID_FILE, 'utf8').trim() === String(child.pid)) unlinkSync(PID_FILE) } catch { /* none */ }
      this.child = null
      this.childExit = { code, signal }
      this.deploy.pid = null
      const tail = tailFile(logFile, 30, this.logOffset || 0)
      this.deploy.tail = tail
      if (!this.stopping) {
        this.deploy.hint = explainFailure(tail.join('\n'))
        this.logger.warn(`Hindsight child exited (code=${code} signal=${signal}); last ${tail.length} log lines from ${logFile}:\n${tail.map((l) => '  | ' + l).join('\n')}${this.deploy.hint ? `\n提示：${this.deploy.hint}` : ''}`)
        this.deploy.error = `进程退出 code=${code}`
        this.#step(this.state === 'ready' ? 'health' : 'start', 'failed', `进程退出 code=${code}${this.deploy.hint ? '：' + this.deploy.hint.split('\n')[0] : ''}`)
      } else {
        this.logger.info(`Hindsight child exited (code=${code} signal=${signal})`)
      }
      if (this.state === 'ready') this.state = 'degraded'
    })
    this.deploy.pid = child.pid
    try { mkdirSync(dirname(PID_FILE), { recursive: true }); writeFileSync(PID_FILE, String(child.pid)) } catch { /* best effort */ }
    if (detached) child.unref()
    this.child = child
    this.startedByUs = true
    return { ok: true, mode: 'process', detail: `pid ${child.pid}` }
  }

  /** Deployment snapshot for the panel: steps, pid, port, RSS memory, log tail. */
  async deployStatus() {
    const d = this.deploy
    const pid = this.child?.pid || null
    let memoryMb = null
    if (pid) {
      try {
        if (process.platform === 'linux') {
          const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
          if (m) memoryMb = Math.round(Number(m[1]) / 1024)
        } else if (process.platform === 'win32') {
          const r = await this.run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeoutMs: 5000 })
          const m = /"([\d,.\s]+) K"/.exec(r.stdout || '')
          if (m) memoryMb = Math.round(Number(m[1].replace(/\D/g, '')) / 1024)
        } else {
          const r = await this.run('ps', ['-o', 'rss=', '-p', String(pid)], { timeoutMs: 5000 })
          if (r.ok && r.stdout.trim()) memoryMb = Math.round(Number(r.stdout.trim()) / 1024)
        }
      } catch { /* best effort */ }
    }
    const tail = d.serverLog ? tailFile(d.serverLog, 30, this.logOffset || 0) : d.tail
    return { ...d, pid, memoryMb, tail: tail.length ? tail : d.tail, installTail: d.installLog ? tailFile(d.installLog, 8) : [], launchMode: this.launchMode, childExit: this.childExit || null }
  }

  /** Graceful shutdown, honouring `keep_alive_on_exit`. */
  async stop() {
    const svc = this.config.service
    if (this.state === 'stopped' || this.stopping) return
    this.stopping = true
    // A boot may still be in flight (docker run / health polling). Wait for it to settle so
    // `startedByUs` is final before we decide whether anything needs to be stopped.
    if (this.pending) await this.pending.catch(() => false)
    const wasReady = this.state
    this.state = 'stopped'
    await this.stopControlPlane().catch(() => {})
    if (!this.startedByUs || svc.keep_alive_on_exit) {
      if (this.startedByUs && svc.keep_alive_on_exit) {
        this.logger.info('Hindsight left running (keep_alive_on_exit=true)')
      }
      return
    }
    const graceMs = Math.max(500, Number(svc.shutdown_grace_ms) || 5000)

    if (this.launchMode === 'docker' && !this.child) {
      const seconds = Math.max(1, Math.round(graceMs / 1000))
      const res = await this.run('docker', ['stop', '-t', String(seconds), svc.docker.container], {
        timeoutMs: graceMs + 15000
      })
      this.logger.info(res.ok ? 'Hindsight container stopped' : `docker stop failed: ${res.stderr.trim()}`)
      return
    }

    if (this.launchMode === 'compose') {
      const d = svc.docker
      if (d.compose_file) {
        const res = await this.run(
          'docker',
          ['compose', '-f', d.compose_file, 'stop', d.compose_service].filter(Boolean),
          { timeoutMs: graceMs + 20000, cwd: dirname(d.compose_file) }
        )
        this.logger.info(res.ok ? 'Hindsight compose service stopped' : `compose stop failed: ${res.stderr.trim()}`)
      }
      return
    }

    const child = this.child
    if (!child) {
      this.logger.debug(`nothing to stop (was ${wasReady})`)
      return
    }
    await new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      child.once('exit', finish)
      try {
        child.kill('SIGTERM')
      } catch {
        finish()
      }
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        finish()
      }, graceMs)
      killTimer.unref?.()
    })
    try {
      if (this.childLog !== null && this.childLog !== undefined) closeSync(this.childLog)
    } catch {
      /* ignore */
    }
    this.childLog = null
    clearInterval(this.logRotateTimer)
    this.child = null
    this.logger.info('Hindsight child stopped')
    await this.#stopEmbeddedDb(graceMs)
  }

  /**
   * hindsight-api leaves its pg0 postgres running after SIGTERM (verified with 1.1.0), and on
   * Windows child.kill() is a hard TerminateProcess, so stop the embedded instance explicitly.
   */
  async #stopEmbeddedDb(graceMs) {
    const plan = this.localPlan
    const url = String(plan?.env?.HINDSIGHT_API_DATABASE_URL || '')
    if (!plan || !url.startsWith('pg0://')) return
    const name = url.slice('pg0://'.length).split(/[/?]/)[0] || 'hindsight'
    const python = plan.kind === 'venv' ? [plan.python] : plan.runner === 'uvx'
      ? ['uvx', '--python', String(this.config.service.local?.python || '3.12'), '--from', 'pg0-embedded', 'python']
      : null
    if (!python) return
    const [cmd, ...pre] = python
    const res = await this.run(cmd, [...pre, '-c', `import pg0; pg0.stop(${JSON.stringify(name)})`], { timeoutMs: graceMs + 30000 })
    this.logger.info(res.ok ? `embedded postgres ${name} stopped` : `pg0 stop ${name} failed: ${res.stderr.trim().slice(-200)}`)
  }
}
