// macOS: system proxy via scutil (GUI apps lack shell *_proxy vars) and PATH for Homebrew/uv.
import assert from 'node:assert/strict'
import { parseScutil, proxyEnv } from '../lib/proxy.js'
import { darwinPath, dataRoot } from '../lib/dataroot.js'
import { venvPaths, pythonCandidates } from '../lib/local.js'
import { wheelTag } from '../lib/bootstrap.js'
let pass = 0
const ok = (n) => { pass++; console.log('ok -', n) }
const out = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
}`
const r = parseScutil(out)
assert.deepEqual(r.proxies, { http: 'http://127.0.0.1:7890', https: 'http://127.0.0.1:7890' }); assert.deepEqual(r.bypass, ['*.local', '169.254/16']); ok('parse scutil --proxy')
assert.equal(parseScutil('<dictionary> {\n  HTTPEnable : 0\n}').enabled, false); ok('disabled proxy')
assert.equal(parseScutil('  SOCKSEnable : 1\n  SOCKSProxy : 127.0.0.1\n  SOCKSPort : 1080\n').proxies.http, 'socks5://127.0.0.1:1080'); ok('socks only')
const e = proxyEnv({ PATH: '/usr/bin' }, { registry: r }).env
assert.equal(e.HTTPS_PROXY, 'http://127.0.0.1:7890'); assert.match(e.NO_PROXY, /localhost/); ok('system proxy reaches the child env')
assert.equal(proxyEnv({ https_proxy: 'http://h:1' }, { registry: r }).env.HTTPS_PROXY, 'http://h:1'); ok('shell env var still wins')
const p = darwinPath('/usr/bin:/bin', '/Users/a')
assert.ok(p.startsWith('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/a/.local/bin')); assert.equal(darwinPath(p, '/Users/a'), p); ok('darwin PATH augmentation idempotent')
assert.equal(dataRoot({ service: { local: {} } }, { platform: 'darwin', home: '/Users/张三', env: {} }).root, '/Users/张三/.dsh-hindsight'); ok('darwin data root = ~/.dsh-hindsight')
assert.equal(venvPaths('/v', 'darwin').server, '/v/bin/hindsight-api'); ok('darwin venv bin/')
assert.deepEqual(pythonCandidates('darwin')[0], ['python3.12']); ok('darwin python candidates')
assert.equal(wheelTag('darwin', 'arm64'), 'macosx_11_0_arm64'); assert.equal(wheelTag('darwin', 'x64'), 'macosx_10_12_x86_64'); ok('uv wheel tag arm64/x64')
console.log(`\n${pass} passed`)
