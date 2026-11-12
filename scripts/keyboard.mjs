/**
 * npm run keyboard — the keyboard path through the interactive parts.
 *
 * Drives the Orrery table, its drawer and the mission overlay toggle with real
 * key presses and asserts focus order, state and Escape-to-close. Writes
 * artifacts/keyboard-report.json.
 *
 * Serve the page first, as with verify:
 *   npm run dev
 *   npm run keyboard
 *   BASE_URL=http://127.0.0.1:3000 npm run keyboard
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { startChromium } from './chromium.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const PORT = Number(process.env.CDP_PORT ?? 9344)
mkdirSync('artifacts', { recursive: true })

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const { browser, child } = await startChromium(PORT)
const context = browser.contexts()[0] ?? (await browser.newContext())
const page = await context.newPage()
await page.setViewportSize({ width: 1440, height: 900 })

const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text().slice(0, 200))
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 200)}`))

await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60_000 })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(1200)

const active = () =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent ?? '').trim().slice(0, 40),
      rowId: el.closest?.('tr')?.dataset?.id ?? null,
      mode: el.dataset?.mode ?? null,
    }
  })

const drawerState = () =>
  page.evaluate(() => {
    const drawer = document.querySelector('#track-drawer')
    const idEl = document.querySelector('#drawer-id')
    const titleEl = document.querySelector('#drawer-title')
    const selected = Array.from(document.querySelectorAll('#tracks-body tr')).filter(
      (row) => row.getAttribute('aria-selected') === 'true',
    )
    return {
      open: Boolean(drawer?.classList.contains('is-open')),
      label: (idEl?.textContent ?? '').trim(),
      title: (titleEl?.textContent ?? '').trim(),
      selectedRows: selected.map((row) => row.dataset.id ?? ''),
      selectedCount: selected.length,
    }
  })

const scrollToOrrery = async () => {
  await page.evaluate(() => {
    const section = document.querySelector('#orrery')
    if (!section) return
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY)
  })
  await page.waitForTimeout(800)
}

/* ------------------------------------------------------------- orrery rows */

await scrollToOrrery()

const rowCount = await page.locator('#tracks-body tr').count()
record('table lists tracks', rowCount > 0, `${rowCount} rows`)

const firstRow = page.locator('#tracks-body tr').first()
await firstRow.focus()
let current = await active()
record('row can take focus', current?.rowId !== null, `active row ${current?.rowId ?? 'none'}`)

await page.keyboard.press('Tab')
current = await active()
record('Tab moves to the next row', current?.rowId !== null, `now ${current?.rowId ?? 'none'}`)

await page.keyboard.press('Shift+Tab')
current = await active()
const backRow = current?.rowId ?? null
const firstId = await firstRow.evaluate((row) => row.dataset.id ?? '')
record('Shift+Tab returns to the previous row', backRow === firstId, `${backRow} vs ${firstId}`)

const ids = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#tracks-body tr')).map((row) => row.dataset.id ?? ''),
)

await page.keyboard.press('ArrowDown')
current = await active()
record('ArrowDown moves focus down the list', current?.rowId === ids[1], `focus ${current?.rowId} / expect ${ids[1]}`)

let drawer = await drawerState()
record('ArrowDown previews without selecting', drawer.label.includes('preview') && drawer.selectedCount === 0, drawer.label)

await page.keyboard.press('ArrowUp')
current = await active()
record('ArrowUp moves focus back', current?.rowId === ids[0], `focus ${current?.rowId}`)

await page.keyboard.press('End')
current = await active()
record('End is left to the page, not the row', current?.rowId === ids[0], `focus ${current?.rowId}`)

/* ----------------------------------------------------------- select/escape */

await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
drawer = await drawerState()
record(
  'Enter selects the focused track',
  drawer.open && drawer.selectedCount === 1 && drawer.selectedRows[0] === ids[1] && !drawer.label.includes('preview'),
  `${drawer.label} · open=${drawer.open} · selected=${drawer.selectedRows.join(',')}`,
)

const desktopRole = await page.evaluate(() => document.querySelector('#track-drawer')?.getAttribute('role') ?? null)
record('desktop: the inline drawer is not a dialog', desktopRole === null, `role=${desktopRole}`)

await page.keyboard.press('Escape')
drawer = await drawerState()
current = await active()
record(
  'Escape closes and keeps focus on the row',
  !drawer.open && drawer.selectedCount === 0 && current?.rowId === ids[1],
  `open=${drawer.open} · selected=${drawer.selectedCount} · focus ${current?.rowId}`,
)

await page.keyboard.press('Space')
drawer = await drawerState()
record('Space selects the focused track', drawer.open && drawer.selectedCount === 1, `${drawer.label} · open=${drawer.open}`)

/* Escape should close from the drawer's own controls, not only from a row. */
await page.locator('#drawer-close').focus()
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
drawer = await drawerState()
record(
  'Escape closes with focus in the drawer',
  !drawer.open && drawer.selectedCount === 0,
  `open=${drawer.open} · selected=${drawer.selectedCount}`,
)

/* And from the page body, where a pointer user's focus usually sits. */
await page.locator('#tracks-body tr').nth(3).focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null))
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
drawer = await drawerState()
record(
  'Escape closes with no element focused',
  !drawer.open && drawer.selectedCount === 0,
  `open=${drawer.open} · selected=${drawer.selectedCount}`,
)

/* Close button still works, and the row stays reachable afterwards. */
await page.locator('#tracks-body tr').nth(2).focus()
await page.keyboard.press('Enter')
await page.locator('#drawer-close').click()
drawer = await drawerState()
record('close button clears the selection', !drawer.open && drawer.selectedCount === 0, `open=${drawer.open}`)

/* -------------------------------------------------------------- mode toggle */

await page.evaluate(() => {
  const section = document.querySelector('#missions')
  if (!section) return
  window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY)
})
await page.waitForTimeout(700)

const civil = page.locator('[data-mode="civil"]')
const defense = page.locator('[data-mode="defense"]')
await civil.focus()

const toggleState = () =>
  page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('[data-mode]'))
    const checked = buttons.find((button) => button.getAttribute('aria-checked') === 'true')
    return {
      checked: checked?.getAttribute('data-mode') ?? null,
      tabStops: buttons.filter((button) => button.tabIndex === 0).map((button) => button.getAttribute('data-mode')),
      label: (document.querySelector('#mode-label')?.textContent ?? '').trim(),
      focus: document.activeElement?.getAttribute?.('data-mode') ?? null,
    }
  })

let toggle = await toggleState()
record('toggle starts on Civil with one tab stop', toggle.checked === 'civil' && toggle.tabStops.length === 1, JSON.stringify(toggle))

await page.keyboard.press('ArrowRight')
toggle = await toggleState()
record(
  'ArrowRight moves to Defense and follows focus',
  toggle.checked === 'defense' && toggle.focus === 'defense' && toggle.label === 'defense',
  JSON.stringify(toggle),
)

await page.keyboard.press('ArrowRight')
toggle = await toggleState()
record('ArrowRight wraps to Civil', toggle.checked === 'civil', JSON.stringify(toggle))

await page.keyboard.press('End')
toggle = await toggleState()
record('End jumps to the last option', toggle.checked === 'defense', JSON.stringify(toggle))

await page.keyboard.press('Home')
toggle = await toggleState()
record('Home jumps to the first option', toggle.checked === 'civil', JSON.stringify(toggle))

await page.keyboard.press('Tab')
toggle = await toggleState()
record('Tab leaves the group', toggle.focus === null, `focus ${toggle.focus}`)

/* ------------------------------------------------------------- scroll keys */

await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(300)
const before = await page.evaluate(() => window.scrollY)
await page.keyboard.press('PageDown')
await page.waitForTimeout(600)
const after = await page.evaluate(() => window.scrollY)
record('PageDown still scrolls the page', after > before + 10, `${before} → ${after}`)

/* ------------------------------------------------- mobile bottom sheet pass */

await page.setViewportSize({ width: 390, height: 844 })
await page.reload({ waitUntil: 'load', timeout: 60_000 })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(1500)

const scrollToSection = async (selector) => {
  await page.evaluate((sel) => {
    const section = document.querySelector(sel)
    if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY)
  }, selector)
  await page.waitForTimeout(800)
}

const sheetState = () =>
  page.evaluate(() => {
    const drawer = document.querySelector('#track-drawer')
    const style = drawer ? getComputedStyle(drawer) : null
    const close = document.querySelector('#drawer-close')
    const active = document.activeElement
    return {
      open: Boolean(drawer?.classList.contains('is-open')),
      position: style?.position ?? null,
      visibility: style?.visibility ?? null,
      bodyOverflow: document.body.style.overflow,
      closeHidden: Boolean(close?.hasAttribute('hidden')),
      focusId: active?.id ?? null,
      focusRow: active?.closest?.('tr')?.dataset?.id ?? null,
    }
  })

await scrollToSection('#orrery')

let sheet = await sheetState()
record(
  'mobile: closed sheet is a fixed, hidden plate',
  sheet.position === 'fixed' && sheet.visibility === 'hidden' && sheet.closeHidden,
  `position=${sheet.position} visibility=${sheet.visibility} closeHidden=${sheet.closeHidden}`,
)

const closeFocusable = await page.evaluate(() => {
  const close = document.querySelector('#drawer-close')
  if (!close) return null
  close.focus()
  return document.activeElement === close
})
record('mobile: closed sheet takes no focus', closeFocusable === false, `close gained focus: ${closeFocusable}`)

const idsMobile = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#tracks-body tr')).map((row) => row.dataset.id ?? ''),
)
await page.locator('#tracks-body tr').nth(1).focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(400)

sheet = await sheetState()
record(
  'mobile: opening the sheet moves focus into it',
  sheet.open && sheet.focusId === 'drawer-close' && !sheet.closeHidden,
  `open=${sheet.open} focus=${sheet.focusId}`,
)
record(
  'mobile: the sheet is visible and the page is locked',
  sheet.visibility === 'visible' && sheet.bodyOverflow === 'hidden',
  `visibility=${sheet.visibility} bodyOverflow=${sheet.bodyOverflow || '(none)'}`,
)

const probe = await page.evaluate(() => {
  const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  const root = document.documentElement
  return {
    prevented: event.defaultPrevented,
    smooth: getComputedStyle(root).scrollBehavior,
    rootOverflow: getComputedStyle(root).overflow,
    rootInline: root.style.overflow,
  }
})
record('mobile: scroll keys are intercepted before the page nav', probe.prevented, JSON.stringify(probe))

const scrollAt = () => page.evaluate(() => window.scrollY)
const dialogState = () =>
  page.evaluate(() => {
    const drawer = document.querySelector('#track-drawer')
    const ids = (drawer?.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
    const name = ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ')
    return {
      role: drawer?.getAttribute('role') ?? null,
      modal: drawer?.getAttribute('aria-modal') ?? null,
      name,
      live: drawer?.getAttribute('aria-live') ?? null,
    }
  })

let dialog = await dialogState()
record(
  'mobile: the sheet is a modal dialog named by the track',
  dialog.role === 'dialog' && dialog.modal === 'true' && /TRK-\d+/.test(dialog.name) && dialog.live === null,
  JSON.stringify(dialog),
)

await page.keyboard.press('Tab')
let trapped = await sheetState()
record('mobile: Tab stays inside the sheet', trapped.focusId === 'drawer-close', `focus=${trapped.focusId || '(none)'}`)

await page.keyboard.press('Shift+Tab')
trapped = await sheetState()
record('mobile: Shift+Tab stays inside the sheet', trapped.focusId === 'drawer-close', `focus=${trapped.focusId || '(none)'}`)

const beforeScroll = await scrollAt()
await page.keyboard.press('PageDown')
const afterFirst = await scrollAt()
await page.waitForTimeout(400)
const afterSettle = await scrollAt()
await page.keyboard.press('PageDown')
await page.waitForTimeout(700)
const afterScroll = await scrollAt()
record(
  'mobile: PageDown cannot scroll the page under the sheet',
  Math.abs(afterScroll - beforeScroll) <= 2,
  `${beforeScroll} → first ${afterFirst} → settle ${afterSettle} → second ${afterScroll}`,
)

await page.keyboard.press('Escape')
await page.waitForTimeout(500)
sheet = await sheetState()
record(
  'mobile: Escape closes, unlocks and returns focus to the row',
  !sheet.open && sheet.visibility === 'hidden' && sheet.bodyOverflow === '' && sheet.focusRow === idsMobile[1],
  `open=${sheet.open} visibility=${sheet.visibility} overflow=${sheet.bodyOverflow || '(none)'} focus=${sheet.focusRow}`,
)

dialog = await dialogState()
record(
  'mobile: closing returns it to a plain live region',
  dialog.role === null && dialog.modal === null && dialog.live === 'polite',
  JSON.stringify(dialog),
)

const unlockedScroll = await page.evaluate(() => window.scrollY)
await page.keyboard.press('PageDown')
await page.waitForTimeout(600)
const unlockedAfter = await page.evaluate(() => window.scrollY)
record(
  'mobile: the page scrolls again once closed',
  unlockedAfter > unlockedScroll + 10,
  `${unlockedScroll} → ${unlockedAfter}`,
)

record('no console errors during the pass', errors.length === 0, errors[0] ?? '')

await browser.close().catch(() => {})
child.kill('SIGKILL')

const failures = checks.filter((check) => !check.ok)
writeFileSync(
  'artifacts/keyboard-report.json',
  JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), checks, failures, errors }, null, 2),
)
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed · report artifacts/keyboard-report.json`)
if (failures.length) {
  console.error(`\nFAIL ${failures.length}`)
  process.exit(1)
}
