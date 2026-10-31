/**
 * Local deployment helpers: preflight validation (refuse to launch a server that would exit at
 * startup), redacted config summary, log files under ~/.dsh-hindsight/logs, log tails and
 * Chinese explanations for common failures. Facts checked against hindsight-api 1.1.0:
 * - slim has no sentence-transformers: embeddings provider defaults to `local` and the server
 *   exits ("sentence-transformers is required for LocalSTEmbeddings") -> a remote embedding
 *   provider is mandatory;
 * - reranker default is `local` too; valid passthrough value in 1.1.0 is `rrf` (`none` is
 *   rejected by cross_encoder.create: "Unknown reranker provider");
 * - LLM default provider is openai/gpt-4o-mini and startup raises "LLM API key is required"
 *   without a key -> we always pass HINDSIGHT_API_LLM_PROVIDER explicitly (`none` when there
 *   is no usable key).
 */
import { dataRoot, isAscii } from './dataroot.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, openSync, readSync, fstatSync, closeSync, existsSync } from 'node:fs'

export const LOG_DIR = process.env.DSH_HINDSIGHT_LOG_DIR || join(homedir(), '.dsh-hindsight', 'logs')
export function logPath(name) {
  try { mkdirSync(LOG_DIR, { recursive: true }) } catch { /* reported by caller */ }
  return join(LOG_DIR, name)
}

const KEYLESS_EMB = new Set(['tei', 'ollama'])
const LOCAL_EMB = new Set(['', 'local', 'onnx'])
const LOCAL_RR = new Set(['local', 'flashrank', 'onnx', 'jina-mlx'])
const KEYLESS_LLM = new Set(['none', 'ollama', 'lmstudio', 'llamacpp'])

/**
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }} Chinese, user-facing.
 */
export function preflight(config, { variant = 'slim', platform = process.platform, home = homedir() } = {}) {
  const errors = []
  const warnings = []
  const emb = config.embedding || {}
  const ep = String(emb.provider || '').toLowerCase()
  if (variant === 'slim') {
    if (LOCAL_EMB.has(ep)) errors.push('未配置远程 Embedding：slim 版不带本地模型，启动会因缺少 sentence-transformers 立即退出。请在面板「Embedding」选择服务商（如 siliconflow / openai / jina）并填写 Key 和模型。')
    if (LOCAL_RR.has(String(config.reranker?.provider || '').toLowerCase())) errors.push(`Reranker「${config.reranker.provider}」需要本地模型，slim 版不支持；请改用 rrf 或远程服务商。`)
  }
  if (ep && !LOCAL_EMB.has(ep)) {
    if (!emb.api_key && !KEYLESS_EMB.has(ep) && !/localhost|127\.0\.0\.1/.test(emb.base_url || '')) errors.push('Embedding API Key 未填写。')
    if (!emb.model) warnings.push('Embedding 模型未填写，将使用 Hindsight 的默认模型名，可能与服务商不匹配。')
    if (ep === 'openai' && !emb.base_url) warnings.push('Embedding base URL 为空，将连接 api.openai.com。')
  }
  const llm = config.llm || {}
  const lp = String(llm.provider || '').toLowerCase()
  if (llm.mode === 'custom' && lp && !KEYLESS_LLM.has(lp) && !llm.api_key) errors.push('自定义抽取 LLM 未填写 API Key（Hindsight 启动会报 "LLM API key is required"）。可填 Key，或改为「跟随 dsh」/「不抽取」。')
  if (platform === 'win32' && /[^\x00-\x7f]/.test(home)) {
    const dr = dataRoot(config, { platform, home })
    if (dr.source === 'legacy') warnings.push(`用户目录含非英文字符（${home}），沿用已有安装；如启动失败，请在高级设置「数据目录」填一个纯英文路径（例如 D:\\dsh-hindsight）后重新部署。`)
    else if (!isAscii(dr.root)) warnings.push(`数据目录 ${dr.root} 含非英文字符，内置数据库可能无法初始化；请改成纯英文路径。`)
  }
  return { ok: errors.length === 0, errors, warnings }
}

/** Secrets → "set"/"unset"; everything else verbatim. Only HINDSIGHT_* keys. */
export function redactEnv(env) {
  const out = {}
  for (const [k, v] of Object.entries(env || {})) {
    if (!k.startsWith('HINDSIGHT_')) continue
    out[k] = /KEY|TOKEN|SECRET|PASSWORD/.test(k) ? (v ? '(已设置)' : '(未设置)') : String(v).replace(/\/\/[^/@]*@/, '//***@')
  }
  return out
}

export function summarizeEnv(env) {
  const r = redactEnv(env)
  const find = (prefix, suffixes) => {
    for (const sfx of suffixes) {
      const k = Object.keys(r).find((key) => key.startsWith(prefix) && key.endsWith(sfx))
      if (k) return r[k]
    }
    return ''
  }
  const part = (p) => {
    const provider = r[`HINDSIGHT_API_${p}_PROVIDER`]
    if (!provider) return ''
    const pre = p === 'LLM' ? 'HINDSIGHT_API_LLM_' : `HINDSIGHT_API_${p}_${provider.toUpperCase()}_`
    return [provider, find(pre, ['_MODEL', '_MODEL_ID']), find(pre, ['_BASE_URL', '_API_BASE', '_URL'])].filter(Boolean).join(' ') +
      ` key ${find(pre, ['_API_KEY']) || '(未设置)'}`
  }
  return `embeddings=[${part('EMBEDDINGS') || '(default=local!)'}] reranker=[${r.HINDSIGHT_API_RERANKER_PROVIDER || '(default=local!)'}] ` +
    `llm=[${r.HINDSIGHT_API_LLM_PROVIDER === 'none' ? 'none（只存原话）' : (part('LLM') || '(default=openai!)')}] db=${r.HINDSIGHT_API_DATABASE_URL || ''}`
}

/** Last `n` lines of a file, reading at most 64 KB from the end (optionally from `fromOffset`). */
export function tailFile(path, n = 30, fromOffset = 0) {
  if (!path || !existsSync(path)) return []
  let fd
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const start = Math.max(fromOffset > size ? 0 : fromOffset, size - 65536) // file rotated (truncated) since offset
    const buf = Buffer.alloc(Math.max(0, size - start))
    readSync(fd, buf, 0, buf.length, start)
    return buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim()).slice(-n)
  } catch {
    return []
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch { /* ignore */ }
  }
}

const RULES = [
  [/DLL load failed while importing _(ctypes|ssl|sqlite3)|0xC0000005|3221225477/i, 'Python 安装已损坏（例如 DLLs 里的 _ctypes.pyd / libffi-8.dll 损坏或版本不匹配，常见于便携版、拷贝来的 Python）：这和密钥、模型设置无关。请重装 Python 3.12（python.org，勾选 "Add to PATH" 和 py 启动器），或把这份 Python 从 PATH 里移除让插件用自带的 Python，然后点「重新部署」（插件会自动重建依赖环境，记忆数据不受影响）。'],
  [/20015|does not support.*(dimension|param)|Invalid parameter.*dimension|unsupport.*dimensions?/i, '向量模型参数错误（例如误传了 dimensions，硅基流动 bge-m3 会返回 400/20015）：本插件已自动丢掉从 dsh 环境继承来的 HINDSIGHT_API_EMBEDDINGS_*_DIMENSIONS；若仍失败请检查插件 .env，并确认「向量维度」只用于本地校验、不会发给服务商（除非你在高级设置里显式填写了 dimensions）。'],
  [/Token is invalid|AuthenticationError|\b40[13]\b[^\n]*(Unauthori[sz]ed|Forbidden|token|api.?key)/i, '密钥无效或已失效（服务商返回 401/403，例如密钥被删除或重新生成过）：请到服务商网站复制一个有效的密钥，在面板里重新填写后点「一键开始」。'],
  [/InvalidURL|Invalid port/, '电脑的代理设置里有无法识别的地址（例如 [::1]），插件已自动处理；如果仍然失败，请在「高级设置 → 代理」选择「不用代理」。'],
  [/\b429\b|rate.?limit|Too Many Requests|quota/i, '模型被限流（请求太频繁或额度用完）：插件会稍后自动重试，要记的内容已排队不会丢；也可以在「高级设置」里给这个模型换一个服务商或模型。'],
  [/\b401\b.*(siliconflow|Unauthorized)|Invalid API key|invalid_api_key/i, '密钥不对：请到对应网站重新复制完整密钥，粘贴到面板后点「一键开始」。'],
  [/sentence-transformers is (required|not installed)|LocalSTEmbeddings/i, '未配置远程 Embedding：slim 版没有本地模型。请在面板填写 Embedding 服务商、Key、模型。'],
  [/LLM API key is required/i, '抽取 LLM 缺少 Key：请填写 Key，或选择「跟随 dsh」（需 dsh 已配置该模型的 Key）/「不抽取」。'],
  [/Unknown reranker provider/i, 'Reranker 名称无效：1.1.0 支持 rrf / cohere / siliconflow / tei 等（不支持 none）。'],
  [/Unknown embeddings? provider/i, 'Embedding 服务商名称无效：OpenAI 兼容服务请用 openai 并填写 base URL。'],
  [/address already in use|Errno 98|Errno 10048|WinError 10048|only one usage of each socket address/i, '端口被占用：请在面板修改端口，或关闭占用该端口的程序（Windows：netstat -ano | findstr :8888）。'],
  [/No module named ['"]?pg0|pg0.*(fail|error)|initdb|could not create shared memory|postgres.*(fail|exited)/i, '内置 PostgreSQL(pg0) 启动失败：检查用户目录是否含中文/空格、杀毒软件拦截，或改用 Docker / 已有 Hindsight。'],
  [/(Could not find a version|No matching distribution|ConnectionError|ReadTimeout|Read timed out|SSLError|CERTIFICATE_VERIFY_FAILED|Failed to download|error sending request)/i, '下载依赖失败（网络/镜像源）：可在面板设置 pip 镜像源，例如清华 https://pypi.tuna.tsinghua.edu.cn/simple 。'],
  [/requires a different Python|Requires-Python|python_requires|No interpreter found for Python/i, 'Python 版本不符：需要 Python 3.11+（推荐 3.12）。'],
  [/(is not recognized as an internal or external command|ENOENT|spawn .* ENOENT)/i, '找不到可执行文件：请安装 Python 3.12（winget install Python.Python.3.12，勾选 "Add to PATH" 与 py 启动器）或 uv（winget install astral-sh.uv）。'],
  [/Microsoft Store|WindowsApps\\python/i, '检测到 Windows 应用商店的 python 占位程序：请安装 python.org 版 Python 3.12，并在「应用执行别名」中关闭 python.exe 别名。'],
  [/401|Unauthorized|invalid api key|Incorrect API key/i, 'API Key 无效或无权限：请检查对应服务商的 Key。'],
  [/UnicodeEncodeError|UnicodeDecodeError|gbk/i, '编码错误（中文 Windows 默认 GBK）：插件已设置 PYTHONUTF8=1；如仍出现请检查路径/配置中的特殊字符。'],
  [/Embedding dimension mismatch|Cannot change embedding dimension|expected \d+ dimensions?, not \d+|different vector dimensions/i, '向量维度不一致：记忆库里已存的向量和现在的 Embedding 模型维度不同。请把「高级设置 → 向量维度」和模型改回原来的设置；要换不同维度的模型，需要先备份并换一个新的空记忆库（见使用文档「迁移和备份记忆」）。已有记忆没有被改动。'],
  [/MemoryError|Killed|out of memory/i, '内存不足。']
]

/** Chinese explanation for a failure log/text; '' when unknown. */
/** Beginner hint for "can't talk to the Hindsight server" (existing service or our own child). */
export function friendlyConnError(error, baseUrl = '') {
  const status = Number(error?.status) || 0
  const msg = String(error?.message || error || '') + ' ' + String(error?.cause?.code || error?.cause?.message || '')
  const keep = '没写进去的对话会先留着，服务恢复后会自动补记。'
  if (status === 401 || status === 403 || /\b40[13]\b|unauthori[sz]ed|forbidden/i.test(msg)) {
    return `记忆服务拒绝了访问（密钥不对）：请在设置里检查「Hindsight API Key」，要和服务端的 HINDSIGHT_API_TENANT_API_KEY 一模一样。${keep}`
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return `找不到记忆服务的地址 ${baseUrl}：请检查设置里的「地址」有没有拼错。${keep}`
  if (/timeout|timed out|aborted|ETIMEDOUT/i.test(msg)) return `记忆服务 ${baseUrl} 响应超时：服务可能卡住了或网络不通，请稍后再试或重启服务。${keep}`
  if (status >= 500) return `记忆服务 ${baseUrl} 出错了（${status}）：请查看服务的日志。${keep}`
  if (/ECONNREFUSED|ECONNRESET|fetch failed|socket|network|connect/i.test(msg) || !status) {
    return `连不上记忆服务 ${baseUrl}：服务没有在运行，或者地址/端口填错了。请先启动 Hindsight，再检查设置里的「地址」。${keep}`
  }
  return ''
}

export function explainFailure(text) {
  const s = String(text || '')
  const hits = RULES.filter(([re]) => re.test(s)).map(([, msg]) => msg)
  return [...new Set(hits)].join('\n')
}

/**
 * Validate the *effective* variables the child will see (.env merged with the panel config),
 * so a hand-edited `.env` counts and a config that never reached us is caught.
 */
export function preflightEnv(env, { variant = 'slim', platform = process.platform, home = homedir() } = {}) {
  const errors = []
  const warnings = []
  const g = (k) => String(env[`HINDSIGHT_API_${k}`] || '')
  const ep = g('EMBEDDINGS_PROVIDER').toLowerCase()
  if (variant === 'slim' && LOCAL_EMB.has(ep)) errors.push('未配置远程 Embedding（HINDSIGHT_API_EMBEDDINGS_PROVIDER 为空或 local）：slim 版不带本地模型，启动会因缺少 sentence-transformers 立即退出。请在面板「Embedding」选择服务商并填写 Key 和模型，或编辑插件目录下的 .env。')
  const P = ep.toUpperCase()
  if (ep === 'openai' || ep === 'cohere' || ep === 'openrouter' || ep === 'nvidia' || ep === 'litellm') {
    const key = g(`EMBEDDINGS_${P}_API_KEY`) || (ep === 'litellm' ? g('EMBEDDINGS_LITELLM_API_KEY') : '')
    const base = g(`EMBEDDINGS_${P}_BASE_URL`) || g('EMBEDDINGS_LITELLM_API_BASE')
    if (!key && !/localhost|127\.0\.0\.1/.test(base) && !(ep === 'openrouter' && g('LLM_API_KEY'))) errors.push(`Embedding API Key 未设置（HINDSIGHT_API_EMBEDDINGS_${P}_API_KEY）。`)
    if (ep === 'openai' && !base) warnings.push('Embedding base URL 为空，将连接 api.openai.com。')
    if (!g(`EMBEDDINGS_${P}_MODEL`)) warnings.push('Embedding 模型未填写，将使用 Hindsight 默认模型名，可能与服务商不匹配。')
  }
  if (ep === 'tei' && !g('EMBEDDINGS_TEI_URL')) errors.push('Embedding=tei 但未填写 TEI 地址（HINDSIGHT_API_EMBEDDINGS_TEI_URL）。')
  const rp = g('RERANKER_PROVIDER').toLowerCase()
  if (!rp && variant === 'slim') errors.push('Reranker 未设置：slim 版默认 local 会启动失败，请设为 rrf。')
  if (rp === 'none') errors.push('Reranker=none 在 hindsight-api 1.1.0 中无效，请改为 rrf。')
  if (variant === 'slim' && LOCAL_RR.has(rp)) errors.push(`Reranker「${rp}」需要本地模型，slim 版不支持；请改用 rrf 或远程服务商。`)
  const lp = g('LLM_PROVIDER').toLowerCase()
  if (!lp) errors.push('抽取 LLM 未设置（HINDSIGHT_API_LLM_PROVIDER 为空，Hindsight 会默认 openai 并因缺少 Key 退出）。请填写 LLM，或选择「跟随 dsh」/「不抽取」。')
  else if (!KEYLESS_LLM.has(lp) && !g('LLM_API_KEY')) errors.push(`抽取 LLM「${lp}」缺少 API Key（HINDSIGHT_API_LLM_API_KEY）。跟随 dsh 时说明未能从 dsh 取得该模型的 Key；可在面板填写 Key，或改为「不抽取」。`)
  if (platform === 'win32' && /[^\x00-\x7f]/.test(home)) warnings.push(`用户目录含非 ASCII 字符（${home}），内置 PostgreSQL(pg0) 可能初始化失败；如启动失败请改用 Docker 或连接已有 Hindsight。`)
  return { ok: errors.length === 0, errors, warnings }
}
