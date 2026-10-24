#!/usr/bin/env node
/**
 * 小黑盒 rejects image URLs with percent-encoded / non-ASCII file names ("图片链接不合法").
 * This copies every image used by docs/小黑盒文章.md to docs/article-img/ under an ASCII name
 * (NN.png from the "NN-说明.png" prefix, cover.png stays) and rewrites the article's image URLs to
 *   https://cdn.jsdelivr.net/gh/snakejohn/dsh-hindsight-local@<ref>/docs/article-img/NN.png
 *
 *   npm run article:assets                  # copy images, keep the current @ref
 *   npm run article:assets -- --ref v0.1.5  # copy images and pin to a tag or a commit sha
 *
 * The images must be committed before the ref exists on GitHub: run it, commit, then pin the
 * URLs to that commit (or to the release tag created afterwards). See CONTRIBUTING.md.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ARTICLE = join(ROOT, 'docs', '小黑盒文章.md')
const SRC = join(ROOT, 'docs', 'images')
const OUT = join(ROOT, 'docs', 'article-img')
const REPO = 'snakejohn/dsh-hindsight-local'

const argRef = (() => { const i = process.argv.indexOf('--ref'); return i > 0 ? process.argv[i + 1] : '' })()
const text = readFileSync(ARTICLE, 'utf8')
const IMG = /!\[([^\]]*)\]\(https:\/\/cdn\.jsdelivr\.net\/gh\/[^@\s]+@([^/\s)]+)\/docs\/(images|article-img)\/([^)\s]+)\)/g

const sources = readdirSync(SRC)
function resolve(dir, file) {
  const name = decodeURIComponent(file)
  if (dir === 'images') {
    const m = /^(\d+)-/.exec(name)
    return { src: name, ascii: m ? `${m[1]}.png` : name }
  }
  // already rewritten: NN.png -> the docs/images file with that number prefix
  const m = /^(\d+)\.png$/.exec(name)
  const src = m ? sources.find((f) => f.startsWith(m[1] + '-')) : name
  return { src, ascii: name }
}

mkdirSync(OUT, { recursive: true })
const used = new Set()
const out = text.replace(IMG, (all, alt, ref, dir, file) => {
  const { src, ascii } = resolve(dir, file)
  if (!src || !existsSync(join(SRC, src))) throw new Error(`article image not found in docs/images: ${file}`)
  if (!/^[A-Za-z0-9._-]+$/.test(ascii)) throw new Error(`not an ASCII file name: ${ascii}`)
  copyFileSync(join(SRC, src), join(OUT, ascii))
  used.add(ascii)
  return `![${alt}](https://cdn.jsdelivr.net/gh/${REPO}@${argRef || ref}/docs/article-img/${ascii})`
})
for (const f of readdirSync(OUT)) if (!used.has(f)) rmSync(join(OUT, f))
if (out !== text) writeFileSync(ARTICLE, out)
console.log(`docs/article-img: ${used.size} images${argRef ? `, URLs pinned to @${argRef}` : ''}`)
