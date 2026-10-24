/**
 * Where the local Hindsight stack keeps its files (venv, uv, Python, pg0 database, model cache).
 *
 * Default: ~/.dsh-hindsight (unchanged). On Windows, when the user profile path has non-ASCII
 * characters (C:\Users\张三), the embedded PostgreSQL (pg0 keeps binaries + data under
 * %USERPROFILE%\.pg0) and the Python tool chain are moved to an ASCII root instead, and the
 * Hindsight process gets HOME/USERPROFILE pointed there (pg0 is Rust: std home_dir() reads
 * USERPROFILE first). Users can always set service.local.data_dir (or DSH_HINDSIGHT_DATA_DIR).
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

export const isAscii = (s) => !/[^\x00-\x7f]/.test(String(s || ''))

function expand(p, home) {
  const t = String(p || '').trim()
  if (t === '~') return home
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(home, t.slice(2))
  return t
}

/**
 * @returns {{ root: string, childHome: string|null, relocated: boolean, source: 'config'|'env'|'default'|'legacy'|'ascii-fallback', note?: string }}
 */
export function dataRoot(config, { platform = process.platform, home = homedir(), env = process.env, exists = existsSync } = {}) {
  const pj = platform === 'win32' ? win32.join : join
  const legacy = pj(home, '.dsh-hindsight')
  const configured = expand(config?.service?.local?.data_dir, home)
  const fromEnv = expand(env.DSH_HINDSIGHT_DATA_DIR, home)
  const custom = configured || fromEnv
  if (custom) {
    return { root: custom, childHome: pj(custom, 'home'), relocated: true, source: configured ? 'config' : 'env' }
  }
  if (platform !== 'win32' || isAscii(home)) return { root: legacy, childHome: null, relocated: false, source: 'default' }
  // An earlier install that already works under the non-ASCII profile: keep it (do not orphan data).
  if (exists(pj(home, '.pg0', 'instances', 'dsh-hindsight')) && exists(pj(legacy, 'venv'))) {
    return { root: legacy, childHome: null, relocated: false, source: 'legacy' }
  }
  const drive = (env.SystemDrive || 'C:').replace(/[\\/]+$/, '')
  const cands = [env.PUBLIC && pj(env.PUBLIC, 'dsh-hindsight'), pj(drive + '\\', 'dsh-hindsight'), env.ProgramData && pj(env.ProgramData, 'dsh-hindsight')]
    .filter((c) => c && isAscii(c))
  const root = cands[0] || pj('C:\\', 'dsh-hindsight')
  return {
    root, childHome: pj(root, 'home'), relocated: true, source: 'ascii-fallback',
    note: `用户目录含中文等非英文字符（${home}），记忆服务的数据改放在 ${root}（可在高级设置「数据目录」修改）`
  }
}

/** Env for the Hindsight child process and uv/pip so nothing lands under a non-ASCII profile. */
export function dataEnv(dr, platform = process.platform) {
  const pj = platform === 'win32' ? win32.join : join
  const env = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  if (!dr.relocated) return env
  Object.assign(env, {
    UV_CACHE_DIR: pj(dr.root, 'uv-cache'),
    UV_PYTHON_INSTALL_DIR: pj(dr.root, 'python'),
    UV_TOOL_DIR: pj(dr.root, 'uv-tools'),
    PIP_CACHE_DIR: pj(dr.root, 'pip-cache'),
    HF_HOME: pj(dr.root, 'hf'),
    TMP: pj(dr.root, 'tmp'), TEMP: pj(dr.root, 'tmp'), TMPDIR: pj(dr.root, 'tmp')
  })
  if (dr.childHome) Object.assign(env, { HOME: dr.childHome, USERPROFILE: dr.childHome })
  return env
}
