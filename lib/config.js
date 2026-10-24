/**
 * Configuration resolution: defaults -> JSON file -> inline plugin config -> environment.
 *
 * The panel schema lives in lib/schema.js and is built from the host's own schemastery
 * (resolved from the running dsh install, never from this package's node_modules), so a
 * plugin installed from a local directory still loads. The schema declares no defaults:
 * defaults stay here, so the precedence below is unchanged. Validation here is explicit,
 * cheap, and logged instead of thrown: a bad value degrades a single feature.
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_CONFIG = {
  enabled: true,
  /**
   * First-run choice from the settings panel.
   *  unset    = not chosen yet: probe base_url only; never starts a server (mode auto). An explicit
   *             service.mode (docker|process|local|compose) is still honoured.
   *  manual   = advanced: legacy behaviour, service.mode decides (auto = attach → docker → ...)
   *  existing = "已配置 Hindsight": attach to service.base_url, never start anything
   *  local    = "未配置": deploy locally (see lib/local.js; Windows = uvx/pip + slim + pg0)
   */
  setup: 'unset',
  /** Where the service lives and how it is started/stopped. */
  service: {
    /** auto = probe first, then fall back to the configured launcher; attach = never start. */
    mode: 'auto',
    base_url: 'http://127.0.0.1:8888',
    api_key: '',
    /** REST prefix that carries the bank-scoped endpoints. */
    api_prefix: '/v1/default',
    health_path: '/health',
    version_path: '/version',
    autostart: true,
    keep_alive_on_exit: false,
    request_timeout_ms: 8000,
    health_timeout_ms: 2500,
    /** Full image downloads embedding/reranker models on first boot: allow minutes. */
    startup_timeout_ms: 300000,
    /** How often a degraded backend is re-probed from the recall/retain path. */
    retry_degraded_ms: 30000,
    retry_interval_ms: 1500,
    shutdown_grace_ms: 5000,
    docker: {
      container: 'hindsight',
      image: 'ghcr.io/vectorize-io/hindsight:latest',
      /** Host port mapped to the container's 8888 (REST). */
      port: 8888,
      /** Host port mapped to the container's 9999 (control plane / web UI). */
      cp_port: 9999,
      restart_policy: 'unless-stopped',
      /** Loopback by default so the unauthenticated API is not exposed to the LAN. */
      bind_host: '127.0.0.1',
      /** Named volume for the embedded Postgres; empty disables persistence (not recommended). */
      volume: 'hindsight-data',
      shm_size: '1g',
      run_timeout_ms: 900000,
      compose_file: '',
      compose_service: 'hindsight',
      network: '',
      extra_args: [],
      extra_env: {}
    },
    process: {
      command: '',
      args: [],
      cwd: '',
      env: {},
      /** Detach the child so it survives DSH exit (overrides keep_alive_on_exit). */
      detached: false
    },
    /** mode=local (setup=local): lightweight local deployment. */
    local: {
      /** auto | venv | uvx | pip | docker. auto: venv -> uvx -> pip -> docker on every OS. */
      runner: 'auto',
      /** Private venv for runner=venv. Empty = ~/.dsh-hindsight/venv. */
      venv_dir: '',
      install_timeout_ms: 1800000,
      /** pip / uv index mirror, e.g. https://pypi.tuna.tsinghua.edu.cn/simple (empty = PyPI). */
      pip_index_url: 'https://pypi.tuna.tsinghua.edu.cn/simple',
      /** Extra pip arguments, e.g. ["--trusted-host", "mirrors.example"]. */
      pip_extra_args: [],
      /** auto | slim | full. auto = slim unless a local embedding/reranker model is chosen. */
      variant: 'auto',
      version: '1.1.0',
      python: '3.12',
      port: 8888,
      /** 同时处理数: retains Hindsight extracts at once (1..4). Free / relay models: keep 1. */
      concurrency: 1,
      /** Embedded PostgreSQL instance (pg0); data lives under ~/.pg0. */
      database_url: 'pg0://dsh-hindsight',
      /** e.g. https://hf-mirror.com when variant=full downloads models from China. */
      hf_endpoint: '',
      // Official Hindsight Control Plane (npm @vectorize-io/hindsight-control-plane, Next.js, port 9999).
      control_plane: { enabled: false, port: 9999, version: '1.1.0' }
    },
    /** Extra environment variables handed to a spawned server (docker/compose/process). */
    /** Network for the local server: auto = system proxy (cleaned), off = direct, custom = url. */
    proxy: { mode: 'auto', url: '' },
    env_extra: {}
  },

  /** Workspace -> bank routing. */
  bank: {
    /** When set, every workspace writes to this bank. */
    default_bank: '',
    /** Template used when no mapping matched: {slug} {hash} {basename} {workspace}. */
    name_template: 'dsh-{slug}-{hash}',
    /** Exact path -> bank_id, or directory prefix -> bank_id (longest prefix wins). */
    workspace_bank_mapping: {},
    /** Honour directory-prefix mappings (so subdirectories share a parent workspace bank). */
    prefix_match: true,
    /** PUT the bank before the first read/write so a fresh server never 404s. */
    ensure_on_use: true,
    mission: '',
    background: ''
  },

  /** Embedding channel. Only used when this plugin launches the server itself. */
  // Initial defaults: SiliconFlow (OpenAI-compatible). One SiliconFlow key covers all three
  // channels: an empty reranker/LLM key reuses the embedding key when the base URL host matches.
  // bge-m3 = 1024 dims (dimension is auto-detected by Hindsight at startup).
  embedding: {
    preset: 'siliconflow',
    provider: 'openai',
    base_url: 'https://api.siliconflow.cn/v1',
    api_key: '',
    model: 'BAAI/bge-m3',
    dimensions: 0,
    /** Expected vector size (bge-m3 = 1024). Guarded against the model and the existing database. */
    expected_dim: 1024,
    batch_size: 0
  },

  /** Reranker channel. top_n / score_threshold are applied client-side too. */
  reranker: {
    enabled: true,
    preset: 'siliconflow',
    provider: 'siliconflow',
    base_url: 'https://api.siliconflow.cn/v1',
    api_key: '',
    model: 'BAAI/bge-reranker-v2-m3',
    top_n: 6,
    score_threshold: 0.25
  },

  /** Server-side LLM used by Hindsight for memory distillation / reflection. */
  llm: {
    // follow = use dsh's default model (provider/base URL/model/key via official services);
    // custom = the fields below; none = no extraction, raw chunks only.
    mode: 'follow',
    // Pre-filled values for mode=custom (SiliconFlow, OpenAI-compatible).
    preset: 'siliconflow',
    provider: 'openai',
    base_url: 'https://api.siliconflow.cn/v1',
    api_key: '',
    model: 'XingChenAGI/Xing4.0-29B',
    temperature: 0.2,
    max_tokens: 1024,
    context_window: 32768
  },

  /** Recall (read path). */
  /** Panel-only display settings. */
  ui: {
    /** 侧栏显示状态卡片: the left-sidebar status card. */
    sidebar_card: true
  },
  /** Role-play time awareness. */
  time: {
    /** IANA zone used for memory text, relative-time parsing and "now". Empty = system zone. */
    timezone: '',
    /** ± minutes around an hour-precise expression ("早上7点") counted as "at that time". */
    window_minutes: 60,
    /** Score bonus for results whose time falls inside the parsed window. */
    window_boost: 0.5,
    /** Put the current local time into every memory block / turn. */
    inject_now: true
  },

  recall: {
    enabled: true,
    budget: 'mid',
    max_tokens: 1200,
    /** Hard character budget for the injected block. */
    max_chars: 4000,
    /** Client-side truncation after reranking. */
    top_n: 6,
    /** Drop results whose final score is below this (0 disables). */
    score_threshold: 0.25,
    types: [],
    tags: [],
    tags_match: 'any',
    /** Skip prompts shorter than this (usually a slash command or an ack). */
    /** Skip prompts shorter than this (CJK chars count double, so "7点干了啥" passes). */
    min_prompt_chars: 6,
    timeout_ms: 6000,
    cooldown_ms: 60000,
    /** Reuse one recall result for repeated identical prompts within this window. */
    cache_ms: 60000,
    /** Cap the query text handed to the retriever. */
    max_query_chars: 2000
  },

  /** Retain (write path). */
  /** Replay existing DSH sessions (sessionPersistence) into Hindsight once ready. */
  backfill: {
    /**
     * v0.1.3: history is NOT imported automatically (a first start used to send every old
     * conversation at once). The panel asks 「要导入以前的对话吗？」 and uses the manual job.
     */
    enabled: false,
    /** 0 / empty = all sessions. */
    max_sessions: 0,
    /** ISO date; sessions created before it are skipped. */
    since: '',
    /** Pause between sessions so the extraction LLM is not flooded. */
    pause_ms: 200
  },

  retain: {
    enabled: true,
    /** Let the server queue the extraction (recommended: never block a turn). */
    async: true,
    /** Turns per retain request; larger batches mean fewer round trips. */
    max_turns_per_batch: 8,
    /** Skip turns whose combined text is shorter than this. */
    min_turn_chars: 24,
    /** 「记住哪些内容」. Only new writes are affected; memories already stored stay as they are.
     *  The plugin's own injected memory blocks are always excluded (no feedback loop). */
    include_user: true,
    retain_assistant: true,
    include_tool_calls: false,
    max_tool_chars: 400,
    include_reasoning: false,
    max_reasoning_chars: 600,
    include_system: false,
    include_archived: false,
    include_subagents: false,
    tags: [],
    /** Upper bound for the exit-time flush. */
    flush_timeout_ms: 8000,
    state_dir: '~/.dsh-hindsight/state',
    /** Re-check readiness this often while degraded; on ready, every live session's
     *  unretained turns (written while Hindsight was down) are flushed. */
    catchup_poll_ms: 5000
  },

  /** Prune (context reduction). Uses the official compaction engine. */
  prune: {
    /** Off by default: DSH already runs pressure compaction; summarising role-play turns
     * early loses detail. Turn on only if you really want earlier folding. */
    enabled: false,
    /** auto | off — `auto` prunes through ctx.compaction when it is available. */
    mode: 'auto',
    /** Number of most recent user turns kept verbatim. */
    keep_recent_turns: 6,
    /** Do not prune until the session history exceeds this many user turns. */
    trigger_after_turns: 12,
    /** Never prune fewer than this many turns at once (avoids thrash). */
    min_prune_turns: 2
  },

  logging: {
    level: 'info',
    /** Defaults to ~/.dsh-hindsight/plugin.log */
    file: '',
    /** Mirror warn/error into stderr as well. */
    console: false
  },

  /** Optional external JSON config merged before the inline config. */
  file: ''
}

const ENV_MAP = [
  ['DSH_HINDSIGHT_ENABLED', 'enabled', 'bool'],
  ['DSH_HINDSIGHT_CONFIG_FILE', 'file', 'string'],

  ['DSH_HINDSIGHT_SETUP', 'setup', 'string'],
  ['DSH_HINDSIGHT_SERVICE_MODE', 'service.mode', 'string'],
  ['DSH_HINDSIGHT_LOCAL_RUNNER', 'service.local.runner', 'string'],
  ['DSH_HINDSIGHT_LOCAL_PORT', 'service.local.port', 'number'],
  ['DSH_HINDSIGHT_BASE_URL', 'service.base_url', 'string'],
  ['DSH_HINDSIGHT_API_KEY', 'service.api_key', 'string'],
  ['DSH_HINDSIGHT_API_PREFIX', 'service.api_prefix', 'string'],
  ['DSH_HINDSIGHT_HEALTH_PATH', 'service.health_path', 'string'],
  ['DSH_HINDSIGHT_AUTOSTART', 'service.autostart', 'bool'],
  ['DSH_HINDSIGHT_KEEP_ALIVE', 'service.keep_alive_on_exit', 'bool'],
  ['DSH_HINDSIGHT_REQUEST_TIMEOUT_MS', 'service.request_timeout_ms', 'number'],
  ['DSH_HINDSIGHT_STARTUP_TIMEOUT_MS', 'service.startup_timeout_ms', 'number'],
  ['DSH_HINDSIGHT_SETTLE_TIMEOUT_MS', 'service.shutdown_grace_ms', 'number'],

  ['DSH_HINDSIGHT_DOCKER_CONTAINER', 'service.docker.container', 'string'],
  ['DSH_HINDSIGHT_DOCKER_IMAGE', 'service.docker.image', 'string'],
  ['DSH_HINDSIGHT_DOCKER_PORT', 'service.docker.port', 'number'],
  ['DSH_HINDSIGHT_DOCKER_CP_PORT', 'service.docker.cp_port', 'number'],
  ['DSH_HINDSIGHT_DOCKER_COMPOSE_FILE', 'service.docker.compose_file', 'string'],

  ['DSH_HINDSIGHT_PROCESS_COMMAND', 'service.process.command', 'string'],
  ['DSH_HINDSIGHT_PROCESS_ARGS', 'service.process.args', 'list'],
  ['DSH_HINDSIGHT_PROCESS_CWD', 'service.process.cwd', 'string'],

  ['DSH_HINDSIGHT_BANK_DEFAULT', 'bank.default_bank', 'string'],
  ['DSH_HINDSIGHT_BANK_TEMPLATE', 'bank.name_template', 'string'],
  ['DSH_HINDSIGHT_BANK_MAPPING', 'bank.workspace_bank_mapping', 'json'],
  ['DSH_HINDSIGHT_BANK_PREFIX_MATCH', 'bank.prefix_match', 'bool'],

  ['DSH_HINDSIGHT_EMBEDDING_PROVIDER', 'embedding.provider', 'string'],
  ['DSH_HINDSIGHT_EMBEDDING_BASE_URL', 'embedding.base_url', 'string'],
  ['DSH_HINDSIGHT_EMBEDDING_API_KEY', 'embedding.api_key', 'string'],
  ['DSH_HINDSIGHT_EMBEDDING_MODEL', 'embedding.model', 'string'],
  ['DSH_HINDSIGHT_EMBEDDING_DIMENSIONS', 'embedding.dimensions', 'number'],
  ['DSH_HINDSIGHT_EMBEDDING_DIM', 'embedding.expected_dim', 'number'],
  ['DSH_HINDSIGHT_EMBEDDING_BATCH_SIZE', 'embedding.batch_size', 'number'],

  ['DSH_HINDSIGHT_RERANKER_ENABLED', 'reranker.enabled', 'bool'],
  ['DSH_HINDSIGHT_RERANKER_PROVIDER', 'reranker.provider', 'string'],
  ['DSH_HINDSIGHT_RERANKER_BASE_URL', 'reranker.base_url', 'string'],
  ['DSH_HINDSIGHT_RERANKER_API_KEY', 'reranker.api_key', 'string'],
  ['DSH_HINDSIGHT_RERANKER_MODEL', 'reranker.model', 'string'],
  ['DSH_HINDSIGHT_RERANKER_TOP_N', 'reranker.top_n', 'number'],
  ['DSH_HINDSIGHT_RERANKER_SCORE_THRESHOLD', 'reranker.score_threshold', 'number'],

  ['DSH_HINDSIGHT_LLM_MODE', 'llm.mode', 'string'],
  ['DSH_HINDSIGHT_LLM_PROVIDER', 'llm.provider', 'string'],
  ['DSH_HINDSIGHT_LLM_BASE_URL', 'llm.base_url', 'string'],
  ['DSH_HINDSIGHT_LLM_API_KEY', 'llm.api_key', 'string'],
  ['DSH_HINDSIGHT_LLM_MODEL', 'llm.model', 'string'],
  ['DSH_HINDSIGHT_LLM_TEMPERATURE', 'llm.temperature', 'number'],
  ['DSH_HINDSIGHT_LLM_MAX_TOKENS', 'llm.max_tokens', 'number'],
  ['DSH_HINDSIGHT_LLM_CONTEXT_WINDOW', 'llm.context_window', 'number'],

  ['DSH_HINDSIGHT_RECALL_ENABLED', 'recall.enabled', 'bool'],
  ['DSH_HINDSIGHT_RECALL_BUDGET', 'recall.budget', 'string'],
  ['DSH_HINDSIGHT_RECALL_MAX_TOKENS', 'recall.max_tokens', 'number'],
  ['DSH_HINDSIGHT_RECALL_MAX_CHARS', 'recall.max_chars', 'number'],
  ['DSH_HINDSIGHT_RECALL_TOP_N', 'recall.top_n', 'number'],
  ['DSH_HINDSIGHT_RECALL_SCORE_THRESHOLD', 'recall.score_threshold', 'number'],
  ['DSH_HINDSIGHT_RECALL_TIMEOUT_MS', 'recall.timeout_ms', 'number'],
  ['DSH_HINDSIGHT_RECALL_CACHE_MS', 'recall.cache_ms', 'number'],
  ['DSH_HINDSIGHT_RECALL_COOLDOWN_MS', 'recall.cooldown_ms', 'number'],
  ['DSH_HINDSIGHT_RECALL_TYPES', 'recall.types', 'list'],

  ['DSH_HINDSIGHT_RETAIN_ENABLED', 'retain.enabled', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_ASYNC', 'retain.async', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_MAX_TURNS', 'retain.max_turns_per_batch', 'number'],
  ['DSH_HINDSIGHT_RETAIN_STATE_DIR', 'retain.state_dir', 'string'],
  ['DSH_HINDSIGHT_RETAIN_USER', 'retain.include_user', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_ASSISTANT', 'retain.retain_assistant', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_TOOL_CALLS', 'retain.include_tool_calls', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_MAX_TOOL_CHARS', 'retain.max_tool_chars', 'number'],
  ['DSH_HINDSIGHT_RETAIN_REASONING', 'retain.include_reasoning', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_SYSTEM', 'retain.include_system', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_ARCHIVED', 'retain.include_archived', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_SUBAGENTS', 'retain.include_subagents', 'bool'],
  ['DSH_HINDSIGHT_RETAIN_MIN_CHARS', 'retain.min_turn_chars', 'number'],
  ['DSH_HINDSIGHT_TIMEZONE', 'time.timezone', 'string'],
  ['DSH_HINDSIGHT_BACKFILL_ENABLED', 'backfill.enabled', 'boolean'],
  ['DSH_HINDSIGHT_BACKFILL_MAX_SESSIONS', 'backfill.max_sessions', 'number'],
  ['DSH_HINDSIGHT_BACKFILL_SINCE', 'backfill.since', 'string'],

  ['DSH_HINDSIGHT_PRUNE_ENABLED', 'prune.enabled', 'bool'],
  ['DSH_HINDSIGHT_KEEP_RECENT_TURNS', 'prune.keep_recent_turns', 'number'],
  ['DSH_HINDSIGHT_PRUNE_TRIGGER_TURNS', 'prune.trigger_after_turns', 'number'],

  ['DSH_HINDSIGHT_LOG_LEVEL', 'logging.level', 'string'],
  ['DSH_HINDSIGHT_LOG_FILE', 'logging.file', 'string']
]

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Structural clone so a resolved config never aliases (and thus mutates) the defaults. */
export function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone)
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = deepClone(item)
    return out
  }
  return value
}

export function deepMerge(base, patch) {
  const target = deepClone(base)
  if (!isPlainObject(patch)) return target
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (isPlainObject(value) && isPlainObject(target[key])) target[key] = deepMerge(target[key], value)
    else target[key] = deepClone(value)
  }
  return target
}

function parseValue(kind, raw) {
  const text = String(raw).trim()
  switch (kind) {
    case 'bool':
      if (/^(1|true|yes|on)$/i.test(text)) return true
      if (/^(0|false|no|off)$/i.test(text)) return false
      return undefined
    case 'number': {
      const n = Number(text)
      return Number.isFinite(n) ? n : undefined
    }
    case 'list':
      return text
        ? text
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    case 'json':
      try {
        return JSON.parse(text)
      } catch {
        return undefined
      }
    default:
      return text
  }
}

function setPath(target, dotted, value) {
  const parts = dotted.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!isPlainObject(cursor[parts[i]])) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function expandPath(value, cwd) {
  if (!value) return ''
  let text = String(value)
  if (text === '~') text = homedir()
  else if (text.startsWith('~/')) text = join(homedir(), text.slice(2))
  return isAbsolute(text) ? text : resolve(cwd || process.cwd(), text)
}

/**
 * @param {object} inlineConfig config block from cordis.patch.yml
 * @param {{ cwd?: string, env?: Record<string,string|undefined> }} [context]
 */
export function resolveConfig(inlineConfig = {}, context = {}) {
  const env = context.env || process.env
  const cwd = context.cwd || process.cwd()
  const warnings = []

  let merged = deepClone(DEFAULT_CONFIG)

  // Precedence is defaults -> external JSON -> inline plugin config -> environment, so the
  // file is applied first: a value written inline in cordis.patch.yml must win over disk.
  const requestedFile = isPlainObject(inlineConfig) ? inlineConfig.file : undefined
  const externalFile = expandPath(requestedFile || env.DSH_HINDSIGHT_CONFIG_FILE || merged.file || '', cwd)
  if (externalFile) {
    try {
      const parsed = JSON.parse(readFileSync(externalFile, 'utf8'))
      merged = deepMerge(merged, isPlainObject(parsed) ? parsed : {})
      merged.file = externalFile
    } catch (error) {
      warnings.push(`config file ignored (${externalFile}): ${error.message}`)
    }
  }

  if (isPlainObject(inlineConfig)) merged = deepMerge(merged, inlineConfig)

  for (const [envKey, dotted, kind] of ENV_MAP) {
    const raw = env[envKey]
    if (raw === undefined || raw === '') continue
    const parsed = parseValue(kind, raw)
    if (parsed === undefined) {
      warnings.push(`env ${envKey} ignored (invalid ${kind} value)`)
      continue
    }
    setPath(merged, dotted, parsed)
  }

  // Migration: bank.scope (preset/session) was removed; banks are always per workspace.
  // Old values are dropped (their banks stay in Hindsight and can be joined from the panel).
  const legacyScope = (merged.bank && merged.bank.scope) || env.DSH_HINDSIGHT_BANK_SCOPE
  if (merged.bank) delete merged.bank.scope
  if (legacyScope && legacyScope !== 'workspace') {
    warnings.push(`bank.scope "${legacyScope}" 已移除，改为按工作区分库；旧记忆库仍保留，可在工作区设置里「接入已有库」`)
  }
  if (!['unset', 'existing', 'local', 'manual'].includes(merged.setup)) {
    warnings.push(`setup "${merged.setup}" unknown, using "unset"`)
    merged.setup = 'unset'
  }
  if (merged.setup === 'existing') {
    merged.service.mode = 'attach'
    merged.service.autostart = false
  } else if (merged.setup === 'local') {
    merged.service.mode = 'local'
    merged.service.autostart = true
    merged.service.base_url = `http://127.0.0.1:${Number(merged.service.local.port) || 8888}`
  }
  // Shared key: same host as the embedding endpoint and no key of its own.
  const host = (u) => { try { return new URL(u).host } catch { return '' } }
  for (const ch of ['reranker', 'llm']) {
    const c = merged[ch]
    if (c && !c.api_key && merged.embedding?.api_key && host(c.base_url) && host(c.base_url) === host(merged.embedding.base_url)) c.api_key = merged.embedding.api_key
  }
  merged.service.base_url = String(merged.service.base_url || '').replace(/\/+$/, '') || DEFAULT_CONFIG.service.base_url
  merged.service.api_prefix = '/' + String(merged.service.api_prefix || 'v1/default').replace(/^\/+|\/+$/g, '')
  merged.service.health_path = '/' + String(merged.service.health_path || 'health').replace(/^\/+/, '')
  merged.service.version_path = '/' + String(merged.service.version_path || 'version').replace(/^\/+/, '')
  // `~` must be expanded here: the cursor writer just joins paths, and a literal "~" would
  // create a directory named "~" inside the current working directory.
  merged.retain.state_dir = merged.retain.state_dir ? expandPath(String(merged.retain.state_dir), cwd) : ''
  if (!/^(auto|attach|local|docker|process|compose)$/.test(merged.service.mode)) {
    warnings.push(`service.mode "${merged.service.mode}" unknown, using "auto"`)
    merged.service.mode = 'auto'
  }
  if (!['low', 'mid', 'high'].includes(merged.recall.budget)) {
    warnings.push(`recall.budget "${merged.recall.budget}" unknown, using "mid"`)
    merged.recall.budget = 'mid'
  }
  if (!/^(any|all|any_strict|all_strict|exact)$/.test(merged.recall.tags_match)) merged.recall.tags_match = 'any'

  merged.recall.max_tokens = Math.max(64, Number(merged.recall.max_tokens) || 1200)
  merged.recall.max_chars = Math.max(200, Number(merged.recall.max_chars) || 4000)
  merged.recall.top_n = Math.max(1, Number(merged.recall.top_n) || 6)
  merged.prune.keep_recent_turns = Math.max(1, Number(merged.prune.keep_recent_turns) || 6)
  merged.prune.trigger_after_turns = Math.max(
    merged.prune.keep_recent_turns + 1,
    Number(merged.prune.trigger_after_turns) || 12
  )
  merged.retain.max_turns_per_batch = Math.max(1, Number(merged.retain.max_turns_per_batch) || 8)
  if (!isPlainObject(merged.bank.workspace_bank_mapping)) {
    warnings.push('bank.workspace_bank_mapping must be an object, ignored')
    merged.bank.workspace_bank_mapping = {}
  }
  if (!['follow', 'custom', 'none'].includes(merged.llm.mode)) merged.llm.mode = 'follow'
  merged.logging.level = String(merged.logging.level || 'info').toLowerCase()

  return { config: merged, warnings, sources: { externalFile: merged.file || '' } }
}

/** Environment variables handed to a server this plugin launches itself. */
/**
 * 「记住哪些内容」 as DSH_HINDSIGHT_RETAIN_* lines for the plugin-root .env (every setting is
 * mirrored there; see lib/dotenv.js). Values come from the resolved config, so the file always
 * shows what the plugin really uses.
 */
export const RETAIN_ENV_KEYS = ['USER', 'ASSISTANT', 'TOOL_CALLS', 'MAX_TOOL_CHARS', 'REASONING', 'SYSTEM', 'ARCHIVED', 'SUBAGENTS', 'MIN_CHARS'].map((k) => 'DSH_HINDSIGHT_RETAIN_' + k)
export function retainEnv(config) {
  const out = {}
  for (const [envKey, path] of ENV_MAP) {
    if (!RETAIN_ENV_KEYS.includes(envKey)) continue
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), config)
    if (v !== undefined && v !== null) out[envKey] = String(v)
  }
  return out
}

export function serviceEnv(config, logger) {
  const env = {}
  const put = (key, value) => {
    if (value === undefined || value === null || value === '') return
    env[key] = String(value)
  }
  // Hindsight reads provider-specific variable names (see hindsight-docs
  // developer/configuration.mdx): HINDSIGHT_API_EMBEDDINGS_<PROVIDER>_* and
  // HINDSIGHT_API_RERANKER_<PROVIDER>_*. Hard-coding OPENAI/COHERE silently ignored
  // every other provider (local, tei, siliconflow, ...).
  const emb = config.embedding
  const embProvider = String(emb.provider || '').toLowerCase()
  put('HINDSIGHT_API_EMBEDDINGS_PROVIDER', embProvider)
  const EMB = {
    openai: { base_url: 'OPENAI_BASE_URL', api_key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL', dimensions: 'OPENAI_DIMENSIONS', batch_size: 'OPENAI_BATCH_SIZE' },
    cohere: { base_url: 'COHERE_BASE_URL', api_key: 'COHERE_API_KEY', model: 'COHERE_MODEL', dimensions: 'COHERE_OUTPUT_DIMENSIONS' },
    litellm: { base_url: 'LITELLM_API_BASE', api_key: 'LITELLM_API_KEY', model: 'LITELLM_MODEL', dimensions: 'LITELLM_DIMENSIONS' },
    nvidia: { base_url: 'NVIDIA_BASE_URL', api_key: 'NVIDIA_API_KEY', model: 'NVIDIA_MODEL', dimensions: 'NVIDIA_DIMENSIONS', batch_size: 'NVIDIA_BATCH_SIZE' },
    openrouter: { api_key: 'OPENROUTER_API_KEY', model: 'OPENROUTER_MODEL' },
    tei: { base_url: 'TEI_URL', batch_size: 'TEI_BATCH_SIZE' },
    local: { model: 'LOCAL_MODEL' },
    onnx: { model: 'ONNX_MODEL_ID', dimensions: 'ONNX_DIMENSIONS', batch_size: 'ONNX_BATCH_SIZE' }
  }
  for (const [field, suffix] of Object.entries(EMB[embProvider] || {})) {
    put(`HINDSIGHT_API_EMBEDDINGS_${suffix}`, emb[field] || undefined)
  }
  if (embProvider && !EMB[embProvider]) logger?.warn?.(`embedding.provider "${embProvider}" has no built-in env mapping; pass its variables through service.env_extra`)

  const rr = config.reranker
  if (rr.enabled === false) put('HINDSIGHT_API_ENABLE_RERANKING', 'false')
  const rrProvider = String(rr.provider || '').toLowerCase()
  put('HINDSIGHT_API_RERANKER_PROVIDER', rrProvider)
  const RR = {
    cohere: { base_url: 'COHERE_BASE_URL', api_key: 'COHERE_API_KEY', model: 'COHERE_MODEL' },
    siliconflow: { base_url: 'SILICONFLOW_BASE_URL', api_key: 'SILICONFLOW_API_KEY', model: 'SILICONFLOW_MODEL' },
    litellm: { base_url: 'LITELLM_API_BASE', api_key: 'LITELLM_API_KEY', model: 'LITELLM_MODEL' },
    nvidia: { base_url: 'NVIDIA_BASE_URL', api_key: 'NVIDIA_API_KEY', model: 'NVIDIA_MODEL' },
    zeroentropy: { base_url: 'ZEROENTROPY_BASE_URL', api_key: 'ZEROENTROPY_API_KEY', model: 'ZEROENTROPY_MODEL' },
    openrouter: { base_url: 'OPENROUTER_BASE_URL', api_key: 'OPENROUTER_API_KEY', model: 'OPENROUTER_MODEL' },
    alibaba: { api_key: 'ALIBABA_API_KEY', model: 'ALIBABA_MODEL' },
    tei: { base_url: 'TEI_URL' },
    local: { model: 'LOCAL_MODEL' },
    flashrank: { model: 'FLASHRANK_MODEL' },
    onnx: { model: 'ONNX_MODEL_ID' }
  }
  for (const [field, suffix] of Object.entries(RR[rrProvider] || {})) {
    put(`HINDSIGHT_API_RERANKER_${suffix}`, rr[field] || undefined)
  }
  if (rrProvider && !RR[rrProvider]) logger?.warn?.(`reranker.provider "${rrProvider}" has no built-in env mapping; pass its variables through service.env_extra`)

  const llm = config.llm
  put('HINDSIGHT_API_LLM_PROVIDER', llm.provider)
  put('HINDSIGHT_API_LLM_BASE_URL', llm.base_url)
  put('HINDSIGHT_API_LLM_API_KEY', llm.api_key)
  put('HINDSIGHT_API_LLM_MODEL', llm.model)
  put('HINDSIGHT_API_LLM_TEMPERATURE', llm.temperature)
  if (config.setup === 'local' && !llm.provider && !llm.api_key) {
    logger?.info?.('llm not configured: local Hindsight runs with LLM provider "none" (raw chunks stored, no fact extraction)')
  } else if (!llm.api_key && !['none', 'ollama', 'lmstudio', 'llamacpp'].includes(String(llm.provider || '').toLowerCase())) {
    logger?.warn?.('llm.api_key is empty: Hindsight needs its own LLM key for fact extraction (it cannot borrow DSH\'s session model); retain will fail until it is set')
  }

  Object.assign(env, config.service.env_extra || {})
  const keys = Object.keys(env)
  if (keys.length) logger?.debug?.(`service env keys: ${keys.join(',')}`)
  return env
}
