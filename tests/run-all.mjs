/**
 * Runs every test file in its own process and prints a summary.
 * Exit code is non-zero when any test fails.
 * Run: node tests/run-all.mjs
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const files = [
  'test-timeline.mjs',
  'test-fixes.mjs',
  'test-config-bank.mjs',
  'test-lifecycle.mjs',
  'test-client-http.mjs',
  'test-hooks.mjs',
  'test-panel-local.mjs',
  'test-panel-v2.mjs',
  'test-dotenv-deploy.mjs', 'test-sidebar.mjs',
  'test-v011.mjs',
  'test-dimension.mjs',
  'test-integration.mjs'
]

function runOne(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      out += chunk
    })
    child.on('close', (code) => resolve({ file, code, out }))
  })
}

const results = []
for (const file of files) {
  const result = await runOne(file)
  results.push(result)
  const status = result.code === 0 ? 'OK  ' : 'FAIL'
  const passes = (result.out.match(/^PASS /gm) || []).length
  const skips = (result.out.match(/^SKIP /gm) || []).length
  console.log(`${status} ${file.padEnd(24)} ${passes} pass${skips ? `, ${skips} skip` : ''}`)
  if (result.code !== 0) {
    console.log(result.out.split('\n').slice(-40).join('\n'))
  }
}

const failed = results.filter((r) => r.code !== 0)
console.log(`\n${results.length - failed.length}/${results.length} test files passed`)
process.exit(failed.length === 0 ? 0 : 1)
