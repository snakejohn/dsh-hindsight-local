/**
 * Proxy environment for the Python child (hindsight-api, uv, pip).
 *
 * httpx (used by the OpenAI SDK inside Hindsight) builds a URL pattern from every NO_PROXY
 * entry; an entry like "[::1]" becomes "all://*[::1]" and crashes start-up with
 * `httpx.InvalidURL: Invalid port: ':1]'`. Proxy tools on Windows (Clash, v2rayN, ...) often
 * put such entries into NO_PROXY or the registry bypass list. We therefore hand the child one
 * clean NO_PROXY plus explicit HTTP(S)_PROXY values. urllib.request.getproxies() returns
 * getproxies_environment() or getproxies_registry(): as soon as any *_proxy variable is set,
 * the registry is not read at all, so the explicit values below are what httpx sees.
 * @module lib/proxy
 */
import { execFileSync } from 'node:child_process'

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/
const HOST = /^\.?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/

/** Keep only NO_PROXY entries httpx parses safely. Returns { kept, dropped }. */
export function cleanNoProxy(entries) {
  const kept = []
  const dropped = []
  for (let raw of entries) {
    let e = String(raw || '').trim()
    if (!e) continue
    if (/^\*\.[A-Za-z0-9.-]+$/.test(e)) e = e.slice(1) // *.lan -> .lan (same meaning for httpx/curl)
    if (IPV4.test(e) || HOST.test(e)) { if (!kept.includes(e.toLowerCase())) kept.push(e.toLowerCase()) } else dropped.push(e)
  }
  for (const must of ['localhost', '127.0.0.1']) if (!kept.includes(must)) kept.push(must)
  return { kept, dropped }
}

/** Parse `reg query "HKCU\...\Internet Settings"` output (pure; unit-tested with fake data). */
export function parseRegQuery(text) {
  const val = (name) => {
    const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, 'mi').exec(String(text || ''))
    return m ? m[1].trim() : ''
  }
  const enable = val('ProxyEnable')
  const enabled = /^0x0*1$/i.test(enable) || enable === '1'
  const server = val('ProxyServer')
  const override = val('ProxyOverride')
  const proxies = {}
  if (enabled && server) {
    const spec = server.includes('=') || server.includes(';') ? server : `http=${server};https=${server}`
    for (const part of spec.split(';')) {
      const i = part.indexOf('=')
      if (i < 0) continue
      const proto = part.slice(0, i).trim().toLowerCase()
      let addr = part.slice(i + 1).trim()
      if (!addr || !['http', 'https'].includes(proto)) continue
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(addr)) addr = 'http://' + addr
      proxies[proto] = addr
    }
  }
  return { enabled, proxies, bypass: override ? override.split(';').map((s) => s.trim()).filter(Boolean) : [] }
}

/** Read the Windows user proxy settings; anything going wrong yields "no settings". */
export function readWindowsRegistry({ platform = process.platform, exec = execFileSync } = {}) {
  if (platform !== 'win32') return null
  try {
    const out = exec('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    return parseRegQuery(out)
  } catch { return null }
}

/** Parse `scutil --proxy` output (macOS system proxy; pure, unit-tested). Same shape as parseRegQuery. */
export function parseScutil(text) {
  const t = String(text || '')
  const val = (k) => { const m = new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'm').exec(t); return m ? m[1].trim() : '' }
  const proxies = {}
  for (const [proto, key] of [['http', 'HTTP'], ['https', 'HTTPS']]) {
    if (val(`${key}Enable`) === '1' && val(`${key}Proxy`)) proxies[proto] = `http://${val(`${key}Proxy`)}${val(`${key}Port`) ? ':' + val(`${key}Port`) : ''}`
  }
  if (!proxies.http && !proxies.https && val('SOCKSEnable') === '1' && val('SOCKSProxy')) {
    proxies.http = proxies.https = `socks5://${val('SOCKSProxy')}${val('SOCKSPort') ? ':' + val('SOCKSPort') : ''}`
  }
  const ex = /ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/.exec(t)
  const bypass = ex ? [...ex[1].matchAll(/^\s*\d+\s*:\s*(.+)$/gm)].map((m) => m[1].trim()) : []
  return { enabled: Boolean(proxies.http || proxies.https), proxies, bypass }
}

/** macOS: apps started from Finder/Dock do not inherit shell *_proxy vars; read the system proxy. */
export function readMacProxy({ platform = process.platform, exec = execFileSync } = {}) {
  if (platform !== 'darwin') return null
  try { return parseScutil(exec('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 5000 })) } catch { return null }
}

const isProxyVar = (k) => /_proxy$/i.test(k)

/**
 * Build the child environment.
 * @param {object} env inherited environment (not modified)
 * @param {{ mode?: 'auto'|'off'|'custom', url?: string, registry?: object|null }} opt
 * @returns {{ env: object, summary: string, dropped: string[] }}
 */
export function proxyEnv(env, { mode = 'auto', url = '', registry } = {}) {
  const get = (n) => env[n.toLowerCase()] || env[n.toUpperCase()] || ''
  const out = {}
  for (const [k, v] of Object.entries(env)) if (!isProxyVar(k)) out[k] = v
  const reg = registry === undefined ? (readWindowsRegistry() || readMacProxy()) : registry
  const { kept, dropped } = cleanNoProxy([...get('no_proxy').split(','), ...((reg && reg.bypass) || [])])
  const noProxy = kept.join(',')
  if (mode === 'off') {
    Object.assign(out, { NO_PROXY: '*', no_proxy: '*' })
    return { env: out, summary: '不用代理', dropped }
  }
  let http = ''
  let https = ''
  if (mode === 'custom' && String(url).trim()) {
    http = https = /^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : 'http://' + url.trim()
  } else {
    http = get('http_proxy') || get('all_proxy')
    https = get('https_proxy') || get('all_proxy') || http
    if (!http && !https && reg && reg.enabled) { http = reg.proxies.http || ''; https = reg.proxies.https || http }
    if (!http) http = https
  }
  if (http) Object.assign(out, { HTTP_PROXY: http, http_proxy: http })
  if (https) Object.assign(out, { HTTPS_PROXY: https, https_proxy: https })
  Object.assign(out, { NO_PROXY: noProxy, no_proxy: noProxy })
  const hide = (u) => u.replace(/\/\/[^@/]*@/, '//***@')
  return { env: out, summary: http || https ? `代理 ${hide(https || http)}` : '直连', dropped }
}

/** Panel hint for a start-up log that hit the httpx proxy parsing bug. */
export function proxyHint(text) {
  return /InvalidURL|Invalid port/.test(String(text || '')) ? '电脑的代理设置里有无法识别的地址（例如 [::1]），插件已自动处理；如果仍然失败，请在「高级设置 → 代理」选择「不用代理」。' : ''
}
