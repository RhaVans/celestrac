/**
 * npm run audit — fails the build output on the v2 rules.
 * Static rules run on dist/. The draw-call rule reads artifacts/drawcalls.json,
 * written by the visual verification run; it is skipped when that file is absent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { extname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')

if (!existsSync(dist)) {
  console.error('audit: no dist/. Run npm run build first.')
  process.exit(1)
}

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else files.push(full)
  }
}
walk(dist)

const failures = []
const notes = []
const fail = (rule, detail) => failures.push(`${rule}: ${detail}`)

const textFiles = files.filter((file) => ['.html', '.css', '.js', '.mjs', '.json', '.svg'].includes(extname(file)))
const read = (file) => readFileSync(file, 'utf8')

/* 1. Emoji and pictographic codepoints ------------------------------------ */

const PICTOGRAPHIC =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu

for (const file of textFiles.filter((f) => /\.(html|css|js|svg)$/.test(f))) {
  const content = read(file)
  const match = content.match(PICTOGRAPHIC)
  if (match) fail('emoji', `${relative(root, file)} contains ${JSON.stringify(match.slice(0, 3).join(''))}`)
}

/* 2. Hype vocabulary ------------------------------------------------------ */

const HYPE = [
  'revolutionize',
  'unlock',
  'seamless',
  'empower',
  'next-generation',
  'cutting-edge',
  'ai-powered',
]
for (const file of textFiles.filter((f) => /\.(html|js|css)$/.test(f))) {
  const content = read(file).toLowerCase()
  for (const word of HYPE) {
    if (content.includes(word)) fail('hype', `${relative(root, file)} contains "${word}"`)
  }
}

/* 3. Font families -------------------------------------------------------- */

const ALLOWED_FAMILIES = new Set(['archivo', 'ibm plex mono'])
const ALLOWED_TOKENS = new Set(['var(--font-sans)', 'var(--font-mono)', 'inherit', 'initial', 'unset'])

for (const file of files.filter((f) => f.endsWith('.css'))) {
  const css = read(file)
  for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim().toLowerCase()
    if (ALLOWED_TOKENS.has(value)) continue
    const names = value.split(',').map((name) => name.trim().replace(/^['"]|['"]$/g, ''))
    names.forEach((name) => {
      if (!name) return
      if (['system-ui', 'sans-serif', 'monospace', 'ui-monospace', 'serif'].includes(name)) return
      if (!ALLOWED_FAMILIES.has(name)) fail('font', `${relative(root, file)} declares ${JSON.stringify(name)}`)
    })
  }
}

/* 4. Uppercase outside the annotation class ------------------------------- */

for (const file of files.filter((f) => f.endsWith('.css'))) {
  const css = read(file)
  const blocks = css.split('}')
  for (const block of blocks) {
    if (!/text-transform\s*:\s*uppercase/.test(block)) continue
    const selector = block.split('{')[0] ?? ''
    if (!selector.includes('.annot')) {
      fail('uppercase', `${relative(root, file)} → ${selector.trim().slice(0, 90)}`)
    }
  }
  if (/backdrop-filter\s*:/.test(css)) fail('backdrop-filter', `${relative(root, file)} uses backdrop-filter`)
  if (/gradient\(/.test(css)) fail('gradient', `${relative(root, file)} uses a CSS gradient`)
}

for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = read(file)
  if (/style="[^"]*backdrop-filter/.test(html)) fail('backdrop-filter', `${relative(root, file)} inline style`)
  if (/style="[^"]*gradient\(/.test(html)) fail('gradient', `${relative(root, file)} inline gradient`)
}

/* 5. Initial JS budget ---------------------------------------------------- */

const jsFiles = files.filter((f) => f.endsWith('.js'))
let initial = 0
let three = 0
for (const file of jsFiles) {
  const bytes = gzipSync(readFileSync(file), { level: 9 }).length
  if (/three/i.test(relative(dist, file))) three += bytes
  else initial += bytes
}
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
if (initial > 250 * 1024) fail('budget', `initial JS ${kb(initial)} gzipped exceeds 250 kB`)
notes.push(`initial JS ${kb(initial)} gzip · three chunk ${kb(three)} gzip`)

/* 6. Draw calls ----------------------------------------------------------- */

const drawCallFile = resolve(root, 'artifacts/drawcalls.json')
if (existsSync(drawCallFile)) {
  const data = JSON.parse(readFileSync(drawCallFile, 'utf8'))
  const calls = Array.isArray(data.samples) ? Math.max(...data.samples.map((s) => s.calls)) : data.calls
  if (typeof calls === 'number' && calls > 150) fail('draw calls', `${calls} in the debug overlay`)
  notes.push(`draw calls ${calls} (cap 150)`)
} else {
  notes.push('draw calls: skipped, no artifacts/drawcalls.json from the verification run')
}

/* 7. Report --------------------------------------------------------------- */

console.log('Celestrac audit')
console.log(`files ${files.length} · ${textFiles.length} text`)
notes.forEach((note) => console.log(`  · ${note}`))

if (failures.length > 0) {
  console.error(`\nFAIL ${failures.length}`)
  failures.forEach((failure) => console.error(`  ✗ ${failure}`))
  process.exit(1)
}

console.log('\nPASS')
