/**
 * Settings-panel schema without bundling or importing `@deepseek-ai/*`.
 *
 * dsh's Settings service (packages/settings/settings) only exposes fields that sit under
 * a schemastery node marked `.volatile()`, and it duck-types the plugin's `Config` export
 * (`'toJSON' in schema`). A local-directory install cannot `import '@deepseek-ai/schemastery'`
 * (Node resolves from the plugin's real path), so we resolve it from the *running dsh*:
 * the CLI package lists `@deepseek-ai/schemastery` as a direct dependency, so a resolver
 * rooted at `realpath(process.argv[1])` finds the exact instance dsh itself uses.
 * When nothing resolves (exotic launcher), `Config` stays undefined and the plugin works
 * exactly as before — configuration through cordis.patch.yml / JSON / env.
 */
import { createRequire } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

function candidates(env, argv) {
  const out = []
  if (env.DSH_HINDSIGHT_SCHEMASTERY) out.push({ file: env.DSH_HINDSIGHT_SCHEMASTERY })
  for (const from of [argv[1], process.execPath, join(process.cwd(), 'noop.js')]) {
    if (!from) continue
    try { out.push({ base: realpathSync(from) }) } catch { /* missing */ }
  }
  out.push({ base: import.meta.url })
  return out
}

async function importFile(file) {
  const mod = await import(pathToFileURL(file).href)
  return mod.default || mod.Schema || mod
}

/** @returns {Promise<Function|null>} the host schemastery constructor, or null */
export async function loadSchemastery({ env = process.env, argv = process.argv, log } = {}) {
  for (const c of candidates(env, argv)) {
    try {
      if (c.file) return await importFile(c.file)
      const require = createRequire(c.base)
      let pkgJson
      try { pkgJson = require.resolve('@deepseek-ai/schemastery/package.json') } catch { continue }
      const root = dirname(pkgJson)
      // Published dsh ships lib/; a source checkout run through tsx only has src/.
      for (const rel of ['lib/index.mjs', 'lib/index.cjs', 'src/index.ts']) {
        const file = join(root, rel)
        if (!existsSync(file)) continue
        try {
          const z = await importFile(file)
          if (typeof z === 'function' && typeof z.object === 'function') return z
        } catch (error) { log?.(`schemastery ${file}: ${error.message}`) }
      }
    } catch (error) { log?.(`schemastery resolve: ${error.message}`) }
  }
  return null
}

/** Provider lists exposed in the panel; anything else still works via config/env_extra. */
export const EMBEDDING_PROVIDERS = ['openai', 'cohere', 'litellm', 'nvidia', 'tei', 'onnx', 'local']
export const RERANKER_PROVIDERS = ['rrf', 'cohere', 'siliconflow', 'litellm', 'nvidia', 'zeroentropy', 'openrouter', 'alibaba', 'tei', 'onnx', 'flashrank', 'local']
export const LLM_PROVIDERS = ['deepseek', 'openai', 'anthropic', 'gemini', 'groq', 'ollama', 'lmstudio', 'litellm', 'none']

/**
 * Root is `.volatile()` so the whole tree is editable live; the plugin reloads its
 * runtime on `loader/volatile-update`. No defaults are declared on purpose (see config.js).
 * Unknown keys are preserved by schemastery objects, so advanced keys keep working.
 */
export function buildConfigSchema(z) {
  const str = (d) => z.string().description(d)
  const secret = (d) => z.string().role('secret').description(d)
  const num = (d) => z.number().description(d)
  const bool = (d) => z.boolean().description(d)
  const pick = (list, d) => z.union(list.map((v) => z.const(v))).description(d)
  const channel = (providers, title, extra = {}) => z.object({
    ...extra,
    provider: str(`${title} provider: ${providers.join(' | ')}（其他值同样接受）`),
    base_url: str(`${title} base URL`),
    api_key: secret(`${title} API key`),
    model: str(`${title} model`),
    preset: str(`${title} 预设（面板用：自动填 base URL）`)
  })
  return z.object({
    setup: pick(['unset', 'existing', 'local'], 'unset = 未选择; existing = 已配置 Hindsight; local = 本地部署'),
    enabled: bool('启用插件'),
    service: z.object({
      mode: str('高级：auto | attach | local | docker | process | compose（setup 会覆盖）'),
      base_url: str('Hindsight base URL'),
      api_key: secret('Hindsight API key / tenant key (Authorization: Bearer)'),
      api_prefix: str('REST 前缀，默认 /v1/default'),
      keep_alive_on_exit: bool('退出 dsh 后保留本插件启动的服务'),
      local: z.object({
        runner: pick(['auto', 'venv', 'uvx', 'pip', 'docker'], '本地部署方式（auto=venv 优先）'),
        variant: pick(['auto', 'slim', 'full'], 'slim≈500MB 无本地模型；full 带本地模型'),
        port: num('本地端口'),
        hf_endpoint: str('HF 镜像（仅 full）'),
        pip_index_url: str('pip/uv 镜像源，如 https://pypi.tuna.tsinghua.edu.cn/simple'),
        control_plane: z.object({ enabled: bool('同时启动官方 Control Plane（npx，端口 9999）'), port: num('Control Plane 端口') })
      })
    }),
    bank: z.object({
      default_bank: str('所有工作区共用的 bank（留空则按映射/模板）'),
      workspace_bank_mapping: z.dict(z.string()).description('工作区路径 → bank_id；多个路径可指向同一 bank'),
      scope: pick(['workspace', 'preset', 'session'], 'bank 隔离粒度'),
      name_template: str('未命中映射时的 bank 名模板'),
      prefix_match: bool('子目录继承父目录映射')
    }),
    embedding: channel(EMBEDDING_PROVIDERS, 'Embedding'),
    reranker: channel(RERANKER_PROVIDERS, 'Reranker'),
    llm: channel(LLM_PROVIDERS, 'Hindsight LLM', { mode: pick(['follow', 'custom', 'none'], 'follow=跟随 dsh 默认模型; custom=自定义; none=不抽取') }),
    recall: z.object({ enabled: bool('召回'), top_n: num('召回条数'), score_threshold: num('分数阈值') }),
    retain: z.object({ enabled: bool('写入记忆') }),
    time: z.object({ timezone: str('IANA 时区，留空=系统') }),
    backfill: z.object({ enabled: bool('回填历史会话') })
  }).volatile()
}

/** Unwrap a cosmokit Volatile (or pass a plain object through) into a mutable plain copy. */
export function plainConfig(value) {
  let v = value
  if (v && typeof v === 'object' && typeof v.get === 'function' && !Array.isArray(v)) v = v.get()
  return v === undefined || v === null ? {} : JSON.parse(JSON.stringify(v))
}
