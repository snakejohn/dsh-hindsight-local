// Windows user folders with Chinese characters (C:\Users\张三): the local stack (venv, uv, Python,
// pg0 database, HF cache) must move to an ASCII root, the Hindsight child must get HOME/USERPROFILE
// there (pg0 reads USERPROFILE), and UTF-8 I/O must always be forced.
import assert from 'node:assert/strict'
import { dataRoot, dataEnv, isAscii } from '../lib/dataroot.js'
import { localEnv, planLocal } from '../lib/local.js'
import { preflight } from '../lib/deploy.js'
import { uvPythonEnv } from '../lib/bootstrap.js'
import { DEFAULT_CONFIG } from '../lib/config.js'

let pass = 0
const ok = (n) => { pass++; console.log('ok -', n) }
const cfg = (local = {}) => { const c = structuredClone(DEFAULT_CONFIG); Object.assign(c.service.local, local); return c }
const WIN = { platform: 'win32', home: 'C:\\Users\\张三', env: { PUBLIC: 'C:\\Users\\Public', SystemDrive: 'C:' }, exists: () => false }

assert.equal(isAscii('C:\\Users\\bob'), true); assert.equal(isAscii('C:\\Users\\张三'), false); ok('isAscii')

let d = dataRoot(cfg(), { platform: 'win32', home: 'C:\\Users\\bob', env: {}, exists: () => false })
assert.equal(d.root, 'C:\\Users\\bob\\.dsh-hindsight'); assert.equal(d.relocated, false); ok('ASCII Windows home unchanged')

d = dataRoot(cfg(), WIN)
assert.equal(d.root, 'C:\\Users\\Public\\dsh-hindsight'); assert.equal(d.childHome, 'C:\\Users\\Public\\dsh-hindsight\\home'); assert.equal(d.source, 'ascii-fallback'); assert.match(d.note, /数据目录|数据改放/); ok('Chinese home -> %PUBLIC%\\dsh-hindsight')

d = dataRoot(cfg(), { ...WIN, env: { PUBLIC: 'D:\\公用', SystemDrive: 'C:' } })
assert.equal(d.root, 'C:\\dsh-hindsight'); ok('non-ASCII PUBLIC -> C:\\dsh-hindsight')

d = dataRoot(cfg(), { ...WIN, exists: () => true })
assert.equal(d.source, 'legacy'); assert.equal(d.relocated, false); ok('existing working install under the Chinese home is kept')

d = dataRoot(cfg({ data_dir: 'D:\\hs' }), WIN)
assert.equal(d.root, 'D:\\hs'); assert.equal(d.source, 'config'); ok('service.local.data_dir wins')
d = dataRoot(cfg(), { ...WIN, env: { ...WIN.env, DSH_HINDSIGHT_DATA_DIR: 'E:\\x' } })
assert.equal(d.root, 'E:\\x'); assert.equal(d.source, 'env'); ok('DSH_HINDSIGHT_DATA_DIR')

d = dataRoot(cfg(), { platform: 'linux', home: '/home/张三', env: {}, exists: () => false })
assert.equal(d.root, '/home/张三/.dsh-hindsight'); assert.equal(d.relocated, false); ok('POSIX non-ASCII home unchanged (Postgres handles UTF-8 paths)')

let e = localEnv(cfg(), WIN)
assert.equal(e.PYTHONUTF8, '1'); assert.equal(e.PYTHONIOENCODING, 'utf-8')
assert.equal(e.USERPROFILE, 'C:\\Users\\Public\\dsh-hindsight\\home'); assert.equal(e.HOME, e.USERPROFILE)
assert.equal(e.HF_HOME, 'C:\\Users\\Public\\dsh-hindsight\\hf'); assert.equal(e.UV_CACHE_DIR, 'C:\\Users\\Public\\dsh-hindsight\\uv-cache')
assert.ok(Object.values(e).every(isAscii), 'no non-ASCII value in the child env'); ok('child env: UTF-8 + relocated HOME/USERPROFILE/caches, all ASCII')

e = localEnv(cfg(), { platform: 'linux', home: '/home/bob', env: {}, exists: () => false })
assert.equal(e.PYTHONUTF8, '1'); assert.equal(e.HOME, undefined); assert.equal(e.USERPROFILE, undefined); ok('default env does not touch HOME')

const plan = await planLocal(cfg({ runner: 'venv' }), { ...WIN, has: async () => false, python: async () => ['py', '-3.12'] })
assert.equal(plan.venv, 'C:\\Users\\Public\\dsh-hindsight\\venv'); assert.ok(plan.command.replace(/\//g, '\\').startsWith('C:\\Users\\Public\\dsh-hindsight\\venv\\Scripts\\')); ok('venv under the ASCII root')
const plan2 = await planLocal(cfg({ runner: 'venv', venv_dir: 'D:\\v' }), { ...WIN, has: async () => false, python: async () => ['py'] })
assert.equal(plan2.venv, 'D:\\v'); ok('explicit venv_dir still respected')

assert.equal(uvPythonEnv('', 'C:\\Users\\Public\\dsh-hindsight').UV_PYTHON_INSTALL_DIR.replace(/\//g, '\\'), 'C:\\Users\\Public\\dsh-hindsight\\python'); ok('uv python install dir follows the root')

const w = preflight(cfg(), { platform: 'win32', home: 'C:\\Users\\张三' })
const txt = JSON.stringify(w)
assert.ok(!/可能初始化失败；如启动失败请改用 Docker/.test(txt)); ok('old scary warning gone when auto-relocated')

console.log(`\n${pass} passed`)
