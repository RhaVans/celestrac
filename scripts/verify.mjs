/**
 * npm run verify — the visual instrument check from section 11 of the brief.
 *
 * Screenshots every stage at 390x844, 768x1024, 1440x900 and 1920x1080, then
 * measures colour share against the five brief hexes, horizontal overflow,
 * console errors, text contrast and the draw-call overlay. Writes
 * artifacts/verify-report.json, artifacts/drawcalls.json and artifacts/v2/*.png.
 *
 * The page must already be served (npm run dev or npm run preview):
 *   npm run dev            # in one shell
 *   npm run verify         # in another
 *   BASE_URL=http://127.0.0.1:3000 npm run verify   # when serving elsewhere
 *
 * Chromium is started here as its own process and Playwright attaches over CDP.
 * Launching through Playwright directly proved unstable in a bare container:
 * the browser process exits between launch and the first page. Owning the
 * process also means its stderr is available when something does go wrong.
 *
 * On a Linux box without root, Chromium needs its shared libraries. Playwright's
 * `install-deps` wants root; unprivileged boxes can extract the debs and point
 * LD_LIBRARY_PATH at them (see README).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { startChromium } from './chromium.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const OUT = 'artifacts/v2'
const PORT = Number(process.env.CDP_PORT ?? 9333)
mkdirSync(OUT, { recursive: true })

const PALETTE = [
  { name: 'ground', rgb: [25, 25, 57] },
  { name: 'surface', rgb: [27, 58, 104] },
  { name: 'starlight', rgb: [242, 225, 153] },
  { name: 'data', rgb: [111, 184, 230] },
  { name: 'action', rgb: [236, 180, 77] },
]

const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844 },
  { label: '768x1024', width: 768, height: 1024 },
  { label: '1440x900', width: 1440, height: 900 },
  { label: '1920x1080', width: 1920, height: 1080 },
]

/* ------------------------------------------------------------------ colour */

const nearest = (r, g, b) => {
  let best = 0
  let bestDistance = Infinity
  PALETTE.forEach((entry, index) => {
    const [pr, pg, pb] = entry.rgb
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
}

function shares(file) {
  const png = PNG.sync.read(readFileSync(file))
  const counts = new Array(PALETTE.length).fill(0)
  for (let i = 0; i < png.data.length; i += 4) {
    counts[nearest(png.data[i], png.data[i + 1], png.data[i + 2])] += 1
  }
  const total = png.width * png.height
  const out = {}
  PALETTE.forEach((entry, index) => {
    out[entry.name] = Number(((counts[index] / total) * 100).toFixed(2))
  })
  return out
}

/* ----------------------------------------------------------------- browser */

async function launch() {
  return startChromium(PORT)
}

/* ---------------------------------------------------------------- contrast */

async function contrastAudit(page) {
  return page.evaluate(() => {
    const GROUND = [25, 25, 57]
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (!match) return null
      const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number)
      return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 }
    }
    const channelize = (v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const lum = (c) => 0.2126 * channelize(c[0]) + 0.7152 * channelize(c[1]) + 0.0722 * channelize(c[2])
    const contrast = (a, b) => {
      const la = lum(a)
      const lb = lum(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
    const backdrop = (element) => {
      const stack = []
      let node = element
      while (node instanceof Element) {
        const style = getComputedStyle(node)
        const colour = parse(style.backgroundColor)
        if (colour && colour.alpha > 0.001) stack.push(colour)
        if (colour && colour.alpha > 0.99) break
        node = node.parentElement
      }
      let base = GROUND
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const entry = stack[i]
        base = entry.rgb.map((c, index) => c * entry.alpha + base[index] * (1 - entry.alpha))
      }
      return base
    }

    const rows = []
    const selector = 'h1,h2,h3,p,li,dd,dt,a,button,span,td,th,caption,label'
    for (const element of document.querySelectorAll(selector)) {
      const text = (element.textContent ?? '').trim()
      if (!text || element.children.length > 0) continue
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || style.opacity === '0') continue
      const colour = parse(style.color)
      if (!colour) continue
      const fontPx = parseFloat(style.fontSize)
      const weight = parseInt(style.fontWeight, 10) || 400
      const large = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700)
      const value = contrast(colour.rgb, backdrop(element))
      const need = large ? 3 : 4.5
      rows.push({
        sample: text.slice(0, 40),
        tag: element.tagName.toLowerCase(),
        fontPx: Math.round(fontPx),
        contrast: Number(value.toFixed(2)),
        need,
        pass: value >= need,
      })
    }
    rows.sort((a, b) => a.contrast - b.contrast)
    return { checked: rows.length, failures: rows.filter((row) => !row.pass).slice(0, 10), lowest: rows.slice(0, 5) }
  })
}

async function overflowAudit(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const offenders = []
    if (doc.scrollWidth - doc.clientWidth > 1) {
      for (const element of document.querySelectorAll('body *')) {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0) continue
        if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
          offenders.push({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className.slice(0, 60) : '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          })
        }
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      horizontal: doc.scrollWidth - doc.clientWidth > 1,
      offenders: offenders.slice(0, 8),
    }
  })
}

const STAGES = ['hero', 'orrery', 'tycho', 'products', 'missions', 'contact']

async function runViewport(context, viewport) {
  const page = await context.newPage()
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 200))
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 200)}`))

  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load', timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(2000)

  const tier = await page.evaluate(() => document.documentElement.dataset.tier ?? 'none')
  const gl = await page.evaluate(() => document.documentElement.classList.contains('has-gl'))

  const shots = {}
  const drawCalls = []

  const sampleCalls = async () => {
    const text = await page.evaluate(() => document.getElementById('debug')?.textContent ?? '')
    const match = text.match(/calls\s+(\d+)/)
    if (match) drawCalls.push(Number(match[1]))
  }

  const snap = async (name) => {
    await sampleCalls()
    const file = join(OUT, `${viewport.label}-${name}.png`)
    await page.screenshot({ path: file })
    shots[name] = shares(file)
  }

  const scrollTo = async (selector, ratio = 0) => {
    await page.evaluate(
      ([sel, share]) => {
        const element = document.querySelector(sel)
        if (!element) return
        const top = element.getBoundingClientRect().top + window.scrollY
        const travel = Math.max(0, element.offsetHeight - window.innerHeight)
        window.scrollTo(0, top + travel * share)
      },
      [selector, ratio],
    )
    await page.waitForTimeout(1000)
  }

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  await snap('hero')
  await scrollTo('#hero', 0.55)
  await snap('hero-late')

  await scrollTo('#orrery', 0)
  await snap('orrery')

  const row = page.locator('#tracks-body tr').first()
  if ((await row.count()) > 0) {
    await row.click()
    await page.waitForTimeout(500)
    await snap('orrery-selected')
    await page.keyboard.press('Escape')
  }

  await scrollTo('#tycho', 0)
  await snap('tycho-a')
  await scrollTo('#tycho', 0.7)
  await snap('tycho-b')

  await scrollTo('#products', 0)
  await snap('products')
  await scrollTo('#missions', 0)
  await snap('missions')
  await scrollTo('#contact', 0)
  await snap('contact')

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(700)
  await snap('footer')

  const overflow = await overflowAudit(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  const contrast = await contrastAudit(page)

  const fonts = await page.evaluate(() => {
    const pick = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight }
    }
    return { h1: pick('h1'), h2: pick('h2'), body: pick('.hero__lede'), annot: pick('.annot') }
  })

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${viewport.label}-full.png`), fullPage: true })

  const sections = await page.evaluate((ids) => {
    return ids.map((id) => {
      const element = document.getElementById(id)
      return element ? { id, height: Math.round(element.getBoundingClientRect().height) } : { id, missing: true }
    })
  }, STAGES)

  await page.close()

  return { viewport: viewport.label, tier, gl, shots, errors, overflow, contrast, fonts, sections, drawCalls }
}

/* ------------------------------------------------------------------- main */

const { browser, child } = await launch()
const context = browser.contexts()[0] ?? (await browser.newContext())

const results = []
for (const viewport of VIEWPORTS) {
  try {
    const result = await runViewport(context, viewport)
    results.push(result)
    console.log(
      `${viewport.label} tier=${result.tier} gl=${result.gl} overflow=${result.overflow.horizontal} errors=${result.errors.length} lowestContrast=${result.contrast.lowest[0]?.contrast ?? 'n/a'}`,
    )
  } catch (error) {
    // One retry: a fresh page is cheap, a lost viewport is not.
    try {
      const result = await runViewport(context, viewport)
      results.push(result)
      console.log(`${viewport.label} (retry ok) tier=${result.tier} gl=${result.gl}`)
    } catch (second) {
      results.push({ viewport: viewport.label, failed: String(second).split('\n')[0].slice(0, 200) })
      console.log(`${viewport.label} FAILED ${String(second).split('\n')[0]}`)
    }
  }
}

await browser.close().catch(() => {})
child.kill('SIGKILL')

/* ------------------------------------------------------------- assertions */

const failures = []
const allDrawCalls = results.flatMap((entry) => entry.drawCalls ?? [])
for (const entry of results) {
  if (entry.failed) {
    failures.push(`${entry.viewport}: run failed — ${entry.failed}`)
    continue
  }
  if (entry.overflow.horizontal) {
    failures.push(`${entry.viewport}: horizontal scroll ${entry.overflow.scrollWidth} > ${entry.overflow.clientWidth}`)
  }
  if (entry.errors.length) failures.push(`${entry.viewport}: ${entry.errors.length} console error(s) — ${entry.errors[0]}`)
  if (entry.contrast.failures.length) {
    const worst = entry.contrast.failures[0]
    failures.push(`${entry.viewport}: contrast ${worst.contrast} < ${worst.need} on "${worst.sample}"`)
  }
  if (!entry.gl) failures.push(`${entry.viewport}: WebGL scene never attached (poster only)`)
  for (const [name, share] of Object.entries(entry.shots)) {
    const groundSurface = share.ground + share.surface
    if (groundSurface < 90) failures.push(`${entry.viewport}/${name}: ground+surface ${groundSurface.toFixed(1)}% < 90%`)
    if (share.data > 5) failures.push(`${entry.viewport}/${name}: data ${share.data}% > 5%`)
  }
}
if (allDrawCalls.length && Math.max(...allDrawCalls) > 100) {
  failures.push(`draw calls ${Math.max(...allDrawCalls)} > 100 in the overlay`)
}

const report = {
  base: BASE,
  generatedAt: new Date().toISOString(),
  viewports: results,
  drawCalls: { samples: allDrawCalls, max: allDrawCalls.length ? Math.max(...allDrawCalls) : null },
  failures,
}

writeFileSync('artifacts/verify-report.json', JSON.stringify(report, null, 2))
if (allDrawCalls.length) {
  writeFileSync(
    'artifacts/drawcalls.json',
    JSON.stringify({ samples: allDrawCalls.map((calls) => ({ calls })) }, null, 2),
  )
}

console.log(`\ndraw calls max ${report.drawCalls.max ?? 'n/a'}`)
console.log('report artifacts/verify-report.json')

if (failures.length) {
  console.error(`\nFAIL ${failures.length}`)
  failures.slice(0, 20).forEach((failure) => console.error(`  ✗ ${failure}`))
  process.exit(1)
}
console.log('\nPASS')
