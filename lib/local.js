/**
 * "未配置 Hindsight" branch: plan a local Hindsight deployment for this machine.
 *
 * Default on every OS is the lightweight path documented by Hindsight itself
 * (hindsight-docs/docs/developer/installation.md, "Hardware" + "Windows"):
 *   - package `hindsight-api-slim[embedded-db]` — no PyTorch / local models
 *     ("API — Slim image: 512 MB min RAM ... No local models");
 *   - embedded PostgreSQL via pg0 (`pg0-embedded` ships a win_amd64 wheel);
 *   - embeddings / reranker delegated to external APIs, reranker falls back to
 *     `rrf` (pure rank fusion, no model) when the user leaves it empty.
 * Measured on Linux with a mock embedding API: hindsight-api + pg0 ≈ 538 MB RSS.
 *
 * Runner order (auto, every OS): venv -> uvx -> pip (hindsight-api already on PATH) -> docker
 *   venv : a private venv under ~/.dsh-hindsight/venv, `pip install hindsight-api-slim[embedded-db]`,
 *          then `<venv>/hindsight-api --host 127.0.0.1 --port 8888` as a child process.
 *          This is the Windows default (needs Python >= 3.11; `py -3.12` / `python`).
 * `service.local.runner` pins one of: auto | venv | uvx | pip | docker.
 * Note: the API listens on 8888 (DEFAULT_PORT); 8889 is only the separate worker's metrics port.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'

export const HINDSIGHT_VERSION = '1.1.0'

/** Python interpreters tried for the venv runner, best first. */
export function pythonCandidates(platform) {
  return platform === 'win32'
    ? [['py', '-3.12'], ['py', '-3.13'], ['py', '-3.11'], ['python'], ['python3']]
    : [['python3.12'], ['python3.13'], ['python3.11'], ['python3']]
}

/** Paths inside a venv on this OS. */
export function venvPaths(dir, platform) {
  const bin = platform === 'win32' ? join(dir, 'Scripts') : join(dir, 'bin')
  const exe = platform === 'win32' ? '.exe' : ''
  return { python: join(bin, `python${exe}`), server: join(bin, `hindsight-api${exe}`), marker: join(dir, 'dsh-installed.txt') }
}

/** Embedding providers that need the full (PyTorch) package. */
const LOCAL_MODEL_EMBEDDINGS = new Set(['', 'local'])
const LOCAL_MODEL_RERANKERS = new Set(['local', 'flashrank', 'jina-mlx'])

export function localVariant(config) {
  const emb = String(config.embedding?.provider || '').toLowerCase()
  const rr = String(config.reranker?.provider || '').toLowerCase()
  if (config.service.local?.variant === 'full') return 'full'
  if (config.service.local?.variant === 'slim') return 'slim'
  // An *unset* embedding no longer means "full": the local branch requires a remote embedding
  // (preflight blocks the start), only an explicit `local` model selects the heavy variant.
  return emb === 'local' || LOCAL_MODEL_RERANKERS.has(rr) ? 'full' : 'slim'
}

/** Env added on top of serviceEnv() for a local server. */
export function localEnv(config) {
  const local = config.service.local || {}
  const env = { HINDSIGHT_API_DATABASE_URL: local.database_url || 'pg0://dsh-hindsight' }
  // Slim has no local cross-encoder: an empty reranker would default to `local` and crash.
  // hindsight-api 1.1.0 accepts `rrf` (passthrough) but rejects `none` ("Unknown reranker provider").
  const rr = String(config.reranker?.provider || '').toLowerCase()
  if (rr === 'none' || (!rr && localVariant(config) === 'slim')) env.HINDSIGHT_API_RERANKER_PROVIDER = 'rrf'
  if (config.llm?.mode === 'none' || (!config.llm?.provider && !config.llm?.api_key)) env.HINDSIGHT_API_LLM_PROVIDER = 'none'
  if (local.hf_endpoint) env.HF_ENDPOINT = local.hf_endpoint
  // Hindsight's default LLM deadline is 120s; free/slow models (Xing4.0-29B) measured up to 133s per extraction.
  env.HINDSIGHT_API_LLM_TIMEOUT = String(Number(local.llm_timeout) || 300)
  // Long turns made SiliconFlow drop the connection ("Server disconnected") on ~4k-token extraction outputs.
  // Smaller chunks => shorter per-call outputs. Hindsight 1.1.0 defaults: chunk 3000 chars, 64000 max tokens,
  // and requires max_completion_tokens > chunk_size. Defaults below are pending a real-key measurement.
  const chunk = Number(local.retain_chunk_size) || 1500
  let maxTok = Number(local.retain_max_completion_tokens) || 8000
  if (maxTok <= chunk) maxTok = chunk + 1000
  env.HINDSIGHT_API_RETAIN_CHUNK_SIZE = String(chunk)
  env.HINDSIGHT_API_RETAIN_MAX_COMPLETION_TOKENS = String(maxTok)
  return env
}

/** Problems that make the local plan unusable; the panel shows them too. */
export function localProblems(config) {
  const problems = []
  const variant = localVariant(config)
  const emb = String(config.embedding?.provider || '').toLowerCase()
  if (variant === 'slim' && LOCAL_MODEL_EMBEDDINGS.has(emb)) problems.push('slim variant needs an external embedding provider (embedding.provider)')
  if (config.embedding?.provider && !['tei', 'local', 'onnx'].includes(emb) && !config.embedding.api_key) problems.push('embedding.api_key is empty')
  return problems
}

/**
 * @param {object} config resolved plugin config
 * @param {{ platform?: string, has: (cmd: string) => Promise<boolean> }} probe
 * @returns {Promise<{ kind: 'process'|'docker'|'none', runner: string, command?: string, args?: string[], image?: string, env: object, reason?: string }>}
 */
export async function planLocal(config, probe) {
  const platform = probe.platform || process.platform
  const local = config.service.local || {}
  const port = Number(local.port) || 8888
  const host = '127.0.0.1'
  const variant = localVariant(config)
  const version = local.version || HINDSIGHT_VERSION
  const pkg = variant === 'slim' ? `hindsight-api-slim[embedded-db]==${version}` : `hindsight-api==${version}`
  const env = localEnv(config)
  const serverArgs = ['--host', host, '--port', String(port)]
  const want = local.runner || 'auto'
  const order = want !== 'auto' ? [want]
    : ['venv', 'uvx', 'pip', 'docker']
  for (const runner of order) {
    if (runner === 'venv') {
      const python = probe.python ? await probe.python(pythonCandidates(platform)) : null
      if (python) {
        const dir = local.venv_dir || join(homedir(), '.dsh-hindsight', 'venv')
        const paths = venvPaths(dir, platform)
        return { kind: 'venv', runner, variant, basePython: python, pkg, venv: dir, ...paths, command: paths.server, args: serverArgs, env }
      }
    }
    if (runner === 'uvx' && await probe.has('uvx')) {
      return { kind: 'process', runner, variant, command: 'uvx', args: ['--python', String(local.python || '3.12'), '--from', pkg, 'hindsight-api', ...serverArgs], env }
    }
    if (runner === 'pip' && await probe.has('hindsight-api')) {
      return { kind: 'process', runner, variant, command: 'hindsight-api', args: serverArgs, env }
    }
    if (runner === 'docker' && await probe.has('docker')) {
      const image = `ghcr.io/vectorize-io/hindsight:${version}${variant === 'slim' ? '-slim' : ''}`
      return { kind: 'docker', runner, variant, image, port, env }
    }
  }
  return {
    kind: 'none', runner: want, variant, env,
    reason: platform === 'win32'
      ? `no Python >= 3.11, uvx or hindsight-api found. Install Python 3.12 (winget install Python.Python.3.12) or uv, or run: pip install "${pkg}"`
      : `no Python >= 3.11, uvx, hindsight-api or docker found. Install Python 3.11+ or uv, or: pip install "${pkg}"`
  }
}
