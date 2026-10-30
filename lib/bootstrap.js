// One-click runtime bootstrap for users without Python: download the standalone `uv`
// executable (from PyPI wheels, mirror-aware), then let uv fetch Python 3.12.
import { existsSync, mkdirSync, writeFileSync, chmodSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { inflateRawSync } from 'node:zlib'

export const TOOLS_DIR = () => process.env.DSH_HINDSIGHT_TOOLS_DIR || join(homedir(), '.dsh-hindsight', 'bin')
export const CN_PYPI = 'https://pypi.tuna.tsinghua.edu.cn/simple'
export const CN_PYTHON_MIRROR = 'https://registry.npmmirror.com/-/binary/python-build-standalone'

/** PyPI wheel platform tag fragment for this machine. */
export function wheelTag(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return arch === 'arm64' ? 'win_arm64' : 'win_amd64'
  if (platform === 'darwin') return arch === 'arm64' ? 'macosx_11_0_arm64' : 'macosx_10_12_x86_64'
  return arch === 'arm64' ? 'manylinux_2_17_aarch64' : 'manylinux_2_17_x86_64'
}

/** Minimal zip reader (central directory) — enough for a wheel. */
export function unzipEntry(buf, match) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('不是有效的 zip 文件')
  let p = buf.readUInt32LE(eocd + 16)
  const n = buf.readUInt16LE(eocd + 10)
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    if (match(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + csize)
      return { name, data: method === 0 ? Buffer.from(data) : inflateRawSync(data) }
    }
    p += 46 + nlen + xlen + clen
  }
  return null
}

/**
 * Ensure a `uv` binary: PATH first, then the tools dir, else download.
 * @returns {{ uv: string, downloaded: boolean }}
 */
export async function ensureUv({ has, indexUrl, toolsDir, fetchImpl = fetch, onProgress = () => {}, platform = process.platform, arch = process.arch } = {}) {
  if (has && await has('uv')) return { uv: 'uv', downloaded: false }
  const dir = toolsDir || TOOLS_DIR()
  const exe = join(dir, platform === 'win32' ? 'uv.exe' : 'uv')
  if (existsSync(exe)) return { uv: exe, downloaded: false }
  const indexes = [...new Set([indexUrl, CN_PYPI, 'https://mirrors.aliyun.com/pypi/simple', 'https://pypi.org/simple'].filter(Boolean))]
  const tag = wheelTag(platform, arch)
  let lastErr = ''
  for (const index of indexes) {
    try {
      onProgress(`正在获取下载地址（${new URL(index).host}）`)
      const page = await fetchImpl(`${index.replace(/\/$/, '')}/uv/`, { headers: { Accept: 'text/html' } })
      if (!page.ok) throw new Error(`HTTP ${page.status}`)
      const html = await page.text()
      const links = [...html.matchAll(/href="([^"]+)"[^>]*>\s*(uv-[^<]+\.whl)/g)].filter((m) => m[2].includes(tag))
      if (!links.length) throw new Error(`没有找到适合本机（${tag}）的 uv`)
      const pick = links[links.length - 1]
      const url = new URL(pick[1].replace(/&amp;/g, '&'), `${index.replace(/\/$/, '')}/uv/`).href
      onProgress(`正在下载 ${pick[2]}`)
      const res = await fetchImpl(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const want = platform === 'win32' ? /\.data\/scripts\/uv\.exe$/ : /\.data\/scripts\/uv$/
      const entry = unzipEntry(buf, (n) => want.test(n))
      if (!entry) throw new Error('安装包里没有 uv 程序')
      mkdirSync(dir, { recursive: true })
      writeFileSync(exe + '.tmp', entry.data)
      if (platform !== 'win32') chmodSync(exe + '.tmp', 0o755)
      renameSync(exe + '.tmp', exe)
      return { uv: exe, downloaded: true, from: index }
    } catch (error) {
      lastErr = `${index}: ${error.message}`
    }
  }
  throw new Error(`下载 uv 失败（${lastErr}）`)
}

/** Env for `uv python install`: China mirror for the Python builds when a CN pip mirror is used. */
export function uvPythonEnv(indexUrl, root = join(homedir(), '.dsh-hindsight')) {
  // only-managed: `uv python find` must return the Python uv downloaded, never a (possibly
  // broken, issue #4) interpreter from PATH or the registry.
  const env = { UV_PYTHON_INSTALL_DIR: join(root, 'python'), UV_PYTHON_INSTALL_BIN: '0', UV_PYTHON_PREFERENCE: 'only-managed' }
  if (!indexUrl || /tuna|aliyun|ustc|douban|tencent|huaweicloud|\.cn\//.test(indexUrl)) env.UV_PYTHON_INSTALL_MIRROR = CN_PYTHON_MIRROR
  if (indexUrl) { env.UV_INDEX_URL = indexUrl; env.UV_DEFAULT_INDEX = indexUrl }
  return env
}
