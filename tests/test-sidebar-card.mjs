// 侧栏显示状态卡片 (ui.sidebar_card): default on, off hides the card, follows the saved form.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolveConfig } from '../lib/config.js'

const src = readFileSync(new URL('../web/client.js', import.meta.url), 'utf8')
let loaded
globalThis.document = globalThis.document || { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } }
let React = null, Server = null
try { const req = createRequire(process.env.DSH_REACT_FROM || '/tmp/dshi/node_modules/dsh/package.json'); React = req('react'); Server = req('react-dom/server') } catch { /* optional */ }
new Function('window', src)({ __ModuleLoader__: { load: (m) => { loaded = m } } })
const mod = loaded.factory(() => React || { createElement() {}, useState() {}, useEffect() {}, useRef() {}, useSyncExternalStore() {} })

assert.equal(resolveConfig({}, { env: {} }).config.ui.sidebar_card, true, 'default on')
assert.equal(resolveConfig({ ui: { sidebar_card: false } }, { env: {} }).config.ui.sidebar_card, false)
const form = (v) => ({ subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', value: v }) })
assert.equal(mod.sidebarCardOn(form({})), true)
assert.equal(mod.sidebarCardOn(form(undefined)), true, 'loading form keeps the card')
assert.equal(mod.sidebarCardOn(form({ ui: { sidebar_card: false } })), false)
assert.equal(mod.sidebarCardOn(null), true)
assert.match(src, /侧栏显示状态卡片/)
console.log('ok - sidebar card setting (default on, off hides)')
if (React && Server && mod.SidebarStatus) {
  const api = async () => ({ level: 'green', text: '记忆正常', sig: 'x' })
  const on = Server.renderToString(React.createElement(mod.SidebarStatus, { hsApi: api, hsForm: form({}), wide: true }))
  const off = Server.renderToString(React.createElement(mod.SidebarStatus, { hsApi: api, hsForm: form({ ui: { sidebar_card: false } }), wide: true }))
  assert.match(on, /hs-side/); assert.equal(off, '')
  console.log('ok - SidebarStatus renders nothing when off')
}
// 高级设置 shows Chinese names for option ids; raw English labels are gone.
for (const bad of ['baseUrl: "Base URL"', 'apiKey: "API Key"', 'label: "Control Plane"']) assert.ok(!src.includes(bad), bad)
for (const good of ['硅基流动（siliconflow）', '不用模型（rrf）', '精简版（slim', 'Python 虚拟环境（venv）', '正常运行（ready）']) assert.ok(src.includes(good), good)
console.log('ok - advanced settings localized')
