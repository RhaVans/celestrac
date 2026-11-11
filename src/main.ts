import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './styles.css'

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { createScene, type SceneHandle } from './scene/scene'
import type { MissionMode } from './scene/overlays'

gsap.registerPlugin(ScrollTrigger)

const root = document.documentElement
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
root.classList.toggle('reduced', reduced)
root.classList.add('app-ready')

const $ = <T extends Element>(selector: string, scope: ParentNode = document): T | null =>
  scope.querySelector<T>(selector)
const $$ = <T extends Element>(selector: string, scope: ParentNode = document): T[] =>
  Array.from(scope.querySelectorAll<T>(selector))

const chapters = $$<HTMLElement>('.chapter')
const contactSection = $('#chapter-05')
const railLinks = $$<HTMLAnchorElement>('[data-rail]')
const meterFill = $<HTMLElement>('#meter-fill')
const meterCount = $<HTMLElement>('#meter-count')
const steps = $$<HTMLElement>('.step')

let scene: SceneHandle | null = null
let pinTrigger: ScrollTrigger | null = null
let masterTimeline: gsap.core.Timeline | null = null
let lenis: Lenis | null = null
let currentStep = -1

const canvas = $('#stage-canvas')
if (canvas instanceof HTMLCanvasElement) {
  try {
    const created = createScene(canvas, reduced)
    if (created) {
      scene = created
      root.classList.add('has-gl')
      created.resize()
    }
  } catch (error) {
    console.warn('WebGL scene unavailable; using the static fallback.', error)
    scene = null
    root.classList.remove('has-gl')
  }
}

/* --------------------------------------------------------------- chrome */

function setRail(active: number): void {
  railLinks.forEach((link) => {
    const value = Number(link.dataset.rail)
    link.setAttribute('aria-current', value === active ? 'true' : 'false')
  })
}

function setMeter(progress: number, chapter: number): void {
  if (meterFill) meterFill.style.width = `${Math.round(progress * 100)}%`
  if (meterCount) {
    meterCount.textContent = `${String(chapter).padStart(2, '0')} / 05`
  }
}

function setSteps(active: number): void {
  if (active === currentStep) return
  currentStep = active
  steps.forEach((step, index) => {
    step.classList.toggle('is-current', index === active)
  })
}

function updateChrome(progress: number): void {
  const p = Math.min(1, Math.max(0, progress))
  const chapter = Math.min(4, Math.floor(p * 5 + 0.0001))
  setRail(p <= 0.001 ? 0 : chapter)
  setMeter(p, chapter)
  if (chapter === 4 && p >= 0.8) {
    setSteps(Math.min(3, Math.floor((p - 0.8) / 0.05)))
  } else if (chapter !== 4) {
    setSteps(-1)
  }
}

/* --------------------------------------------------------------- headings */

function splitHeading(element: HTMLElement): HTMLElement[] {
  if (element.dataset.original) {
    return $$<HTMLElement>('.line-inner', element)
  }

  const original = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  element.dataset.original = original
  element.textContent = ''
  element.setAttribute('aria-label', original)

  const words = original.split(' ')
  const wordSpans = words.map((word, index) => {
    const span = document.createElement('span')
    span.textContent = word
    span.style.display = 'inline'
    element.appendChild(span)
    if (index < words.length - 1) element.appendChild(document.createTextNode(' '))
    return span
  })

  const lines: string[][] = []
  let currentTop = Number.NaN
  wordSpans.forEach((span, index) => {
    const top = Math.round(span.offsetTop)
    if (Number.isNaN(currentTop) || Math.abs(top - currentTop) > 2) {
      lines.push([])
      currentTop = top
    }
    lines[lines.length - 1].push(words[index])
  })

  element.textContent = ''
  element.setAttribute('aria-label', original)
  const inner: HTMLElement[] = []
  lines.forEach((line) => {
    const mask = document.createElement('span')
    mask.className = 'line-mask'
    const span = document.createElement('span')
    span.className = 'line-inner'
    span.setAttribute('aria-hidden', 'true')
    span.textContent = line.join(' ')
    mask.appendChild(span)
    element.appendChild(mask)
    inner.push(span)
  })
  return inner
}

function restoreHeadings(): void {
  $$<HTMLElement>('[data-split]').forEach((element) => {
    if (element.dataset.original) {
      element.textContent = element.dataset.original
      element.removeAttribute('aria-label')
      delete element.dataset.original
    }
  })
}

/* ----------------------------------------------------------------- motion */

function buildMotion(linesByChapter: HTMLElement[][]): void {
  const stage = $('#stage')
  const scan = $('.scanline')
  if (!stage || !scan) return

  let heroLines: HTMLElement[] = []

  chapters.forEach((chapter, index) => {
    if (index > 0) {
      gsap.set(chapter, { autoAlpha: 0 })
    }
  })

  heroLines = linesByChapter[0] ?? []
  gsap.set(heroLines, { yPercent: 110 })
  linesByChapter.slice(1).forEach((lines) => gsap.set(lines, { yPercent: 110 }))

  const finePointer = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)')
    .matches
  const horizontal = window.innerWidth >= 640
  const hiddenClip = horizontal ? 'inset(0% 100% 0% 0%)' : 'inset(100% 0% 0% 0%)'
  const revealedClip = 'inset(0% 0% 0% 0%)'
  const clippedAway = horizontal ? 'inset(0% 0% 0% 100%)' : 'inset(100% 0% 0% 0%)'

  chapters.slice(1).forEach((chapter) => gsap.set(chapter, { clipPath: hiddenClip }))

  const snapPoints = [0, 0.2, 0.4, 0.6, 0.8, 1]

  const timeline = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: () => `+=${window.innerHeight * 7.5}`,
      pin: true,
      pinSpacing: true,
      scrub: 1,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        scene?.setProgress(self.progress)
        updateChrome(self.progress)
      },
      onRefresh: (self) => {
        scene?.setProgress(self.progress)
        updateChrome(self.progress)
      },
    },
  })

  // Keeps the timeline at a normalised duration while children are positioned in 0..1.
  timeline.to({ value: 0 }, { value: 1, duration: 1, ease: 'none' }, 0)

  ;[0.2, 0.4, 0.6, 0.8].forEach((boundary, index) => {
    const outgoing = chapters[index]
    const incoming = chapters[index + 1]
    if (!outgoing || !incoming) return
    const start = boundary - 0.06

    timeline.set(incoming, { autoAlpha: 1 }, start)
    timeline.fromTo(
      incoming,
      { clipPath: hiddenClip },
      { clipPath: revealedClip, duration: 0.06, ease: 'none', immediateRender: false },
      start,
    )
    timeline.fromTo(
      outgoing,
      { clipPath: revealedClip },
      { clipPath: clippedAway, duration: 0.06, ease: 'none', immediateRender: false },
      start,
    )
    timeline.set(outgoing, { autoAlpha: 0 }, boundary)

    timeline.set(scan, { opacity: 1, '--sweep': 0 }, start)
    timeline.to(scan, { '--sweep': 1, duration: 0.06, ease: 'none' }, start)
    timeline.set(scan, { opacity: 0 }, boundary)

    const incomingLines = linesByChapter[index + 1] ?? []
    timeline.fromTo(
      incomingLines,
      { yPercent: 110 },
      {
        yPercent: 0,
        duration: 0.05,
        stagger: 0.008,
        ease: 'power2.out',
        immediateRender: false,
      },
      start + 0.004,
    )
  })

  timeline.fromTo('.callouts', { opacity: 0 }, { opacity: 1, duration: 0.04 }, 0.42)
  timeline.to('.callouts', { opacity: 0, duration: 0.03 }, 0.58)

  pinTrigger = timeline.scrollTrigger ?? null
  masterTimeline = timeline

  if (!finePointer) {
    lenis = null
  } else {
    lenis = new Lenis({ lerp: 0.1 })
    let snapTimer = 0
    let snapTarget: number | null = null
    lenis.on('scroll', ({ scroll }) => {
      ScrollTrigger.update()
      const trigger = pinTrigger
      if (!trigger || reduced) return
      if (scroll > trigger.end - 2) return
      if (snapTarget !== null && Math.abs(scroll - snapTarget) < 3) return

      window.clearTimeout(snapTimer)
      snapTimer = window.setTimeout(() => {
        if (!trigger || window.scrollY > trigger.end - 2) return
        const progress = trigger.progress
        const nearest = snapPoints.reduce((best, point) =>
          Math.abs(point - progress) < Math.abs(best - progress) ? point : best,
        )
        if (Math.abs(nearest - progress) < 0.015) return
        snapTarget = trigger.start + nearest * (trigger.end - trigger.start)
        lenis?.scrollTo(snapTarget, {
          duration: 0.65,
          easing: (t: number) => 1 - Math.pow(1 - t, 3),
        })
        window.setTimeout(() => {
          snapTarget = null
        }, 760)
      }, 170)
    })
    gsap.ticker.add((time) => {
      lenis?.raf(time * 1000)
    })
    gsap.ticker.lagSmoothing(0)
  }

  updateChrome(0)
  scene?.setProgress(0)

  if (contactSection) {
    ScrollTrigger.create({
      trigger: contactSection,
      start: 'top bottom',
      end: 'top 15%',
      onUpdate: (self) => {
        scene?.setContact(self.progress)
        root.classList.toggle('is-contact', self.progress > 0.02)
        if (self.progress > 0.08) {
          setRail(5)
          setMeter(1, 5)
          setSteps(-1)
        }
      },
    })
  }

  root.classList.add('motion-ready')
  requestAnimationFrame(() => {
    gsap.fromTo(
      heroLines,
      { yPercent: 110 },
      {
        yPercent: 0,
        duration: 1.1,
        stagger: 0.09,
        ease: 'expo.out',
        delay: 0.15,
      },
    )
  })
}

/* ------------------------------------------------------------- navigation */

function currentChapter(): number {
  if (pinTrigger) {
    if (window.scrollY >= pinTrigger.end - 2) return 5
    return Math.min(4, Math.floor(pinTrigger.progress * 5 + 0.02))
  }
  const sections = $$<HTMLElement>('[data-chapter]')
  const mid = window.innerHeight * 0.45
  let active = 0
  sections.forEach((section) => {
    if (section.getBoundingClientRect().top <= mid) {
      active = Number(section.dataset.chapter ?? 0)
    }
  })
  return active
}

function scrollToY(target: number): void {
  const max = document.documentElement.scrollHeight - window.innerHeight
  const y = Math.min(max, Math.max(0, target))
  if (lenis) {
    lenis.scrollTo(y, { duration: 1.1 })
  } else {
    window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' })
  }
}

function jumpTo(index: number, moveFocus = true): void {
  let y = 0
  if (pinTrigger) {
    y =
      index >= 5
        ? pinTrigger.end + 8
        : pinTrigger.start + (index / 5) * (pinTrigger.end - pinTrigger.start) + 2
  } else {
    const target =
      index >= 5
        ? contactSection
        : document.getElementById(`chapter-0${Math.min(4, Math.max(0, index))}`)
    if (target) y = target.getBoundingClientRect().top + window.scrollY
  }

  scrollToY(y)

  if (moveFocus) {
    const heading =
      index >= 5
        ? contactSection?.querySelector<HTMLElement>('h2')
        : document
            .getElementById(`chapter-0${Math.min(4, Math.max(0, index))}`)
            ?.querySelector<HTMLElement>('h1, h2')
    window.setTimeout(() => {
      if (!heading) return
      heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: true })
    }, 850)
  }
}

function moveChapter(delta: number): void {
  const next = Math.min(5, Math.max(0, currentChapter() + delta))
  jumpTo(next, false)
}

document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest<HTMLElement>('[data-jump]')
  if (!link) return
  event.preventDefault()
  const index = Number(link.dataset.jump)
  if (menuOpen) closeMenu(false)
  jumpTo(index)
})

document.addEventListener('keydown', (event) => {
  if (menuOpen) return
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="radio"]')) return

  if (event.key === 'PageDown' || event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault()
    moveChapter(1)
  } else if (event.key === 'PageUp' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault()
    moveChapter(-1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    jumpTo(0, false)
  } else if (event.key === 'End') {
    event.preventDefault()
    jumpTo(5, false)
  }
})

/* ------------------------------------------------------------------- menu */

const menu = $<HTMLElement>('#mobile-menu')
const menuOpenButton = $<HTMLButtonElement>('#menu-open')
const menuCloseButton = $<HTMLButtonElement>('#menu-close')
let menuOpen = false
let previousFocus: HTMLElement | null = null
let previousOverflow = ''

function menuFocusables(): HTMLElement[] {
  if (!menu) return []
  return $$<HTMLElement>('a[href], button:not([disabled])', menu).filter(
    (element) => element.offsetParent !== null,
  )
}

function openMenu(): void {
  if (!menu || !menuOpenButton) return
  menuOpen = true
  previousFocus = document.activeElement as HTMLElement | null
  previousOverflow = document.body.style.overflow
  menu.hidden = false
  menuOpenButton.setAttribute('aria-expanded', 'true')
  document.body.style.overflow = 'hidden'
  lenis?.stop()
  menuCloseButton?.focus()
  document.addEventListener('keydown', onMenuKeydown, true)
}

function closeMenu(restoreFocus = true): void {
  if (!menu || !menuOpenButton) return
  menuOpen = false
  menu.hidden = true
  menuOpenButton.setAttribute('aria-expanded', 'false')
  document.body.style.overflow = previousOverflow
  lenis?.start()
  document.removeEventListener('keydown', onMenuKeydown, true)
  if (restoreFocus) previousFocus?.focus()
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (!menuOpen) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    return
  }
  if (event.key !== 'Tab') return
  const focusables = menuFocusables()
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !menu?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !menu?.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

menuOpenButton?.addEventListener('click', openMenu)
menuCloseButton?.addEventListener('click', () => closeMenu())

/* ---------------------------------------------------------------- missions */

const modeButtons = $$<HTMLButtonElement>('[data-mode]')
const modePanels = $$<HTMLElement>('.mission-panel')

function selectMode(mode: MissionMode, focus = false): void {
  modeButtons.forEach((button) => {
    const checked = button.dataset.mode === mode
    button.classList.toggle('is-checked', checked)
    button.setAttribute('aria-checked', String(checked))
    button.tabIndex = checked ? 0 : -1
    if (checked && focus) button.focus()
  })
  modePanels.forEach((panel) => {
    panel.hidden = panel.id !== `panel-${mode}`
  })
  scene?.setMode(mode, reduced)
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectMode((button.dataset.mode as MissionMode) ?? 'civil')
  })
})

modeButtons.forEach((button, index) => {
  button.addEventListener('keydown', (event) => {
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % modeButtons.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + modeButtons.length) % modeButtons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = modeButtons.length - 1
    else return
    event.preventDefault()
    event.stopPropagation()
    selectMode((modeButtons[next].dataset.mode as MissionMode) ?? 'civil', true)
  })
})

/* -------------------------------------------------------------------- form */

const form = $<HTMLFormElement>('#briefing-form')
const fieldsWrap = $<HTMLElement>('#briefing-fields')
const submitButton = $<HTMLButtonElement>('.form__submit')
const formStatus = $<HTMLElement>('#form-status')
const formStatusText = $<HTMLElement>('#form-status-text')
const retryButton = $<HTMLButtonElement>('#form-retry')
const hudLat = $('#hud-lat')
const hudLon = $('#hud-lon')
const hudTracks = $('#hud-tracks')
const hudUtc = $('#hud-utc')

interface FieldSpec {
  input: HTMLInputElement | HTMLTextAreaElement | null
  error: HTMLElement | null
  message: string
  validate: (value: string) => string | null
}

const required = (message: string) => (value: string) => (value.trim() ? null : message)
const emailValid = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

const fieldSpecs: FieldSpec[] = [
  {
    input: $<HTMLInputElement>('#field-name'),
    error: $<HTMLElement>('#error-name'),
    message: 'Enter your name.',
    validate: required('Enter your name.'),
  },
  {
    input: $<HTMLInputElement>('#field-org'),
    error: $<HTMLElement>('#error-org'),
    message: 'Enter your organization.',
    validate: required('Enter your organization.'),
  },
  {
    input: $<HTMLInputElement>('#field-email'),
    error: $<HTMLElement>('#error-email'),
    message: 'Enter your work email.',
    validate: (value) => {
      if (!value.trim()) return 'Enter your work email.'
      return emailValid(value) ? null : 'Enter a valid work email.'
    },
  },
  {
    input: $<HTMLTextAreaElement>('#field-message'),
    error: $<HTMLElement>('#error-message'),
    message: 'Tell us what you need to see.',
    validate: required('Tell us what you need to see.'),
  },
]

let sending = false
let submitted = false
let formError = false

function setFieldError(spec: FieldSpec, message: string | null): void {
  if (!spec.input || !spec.error) return
  if (message) {
    spec.error.textContent = message
    spec.error.hidden = false
    spec.input.setAttribute('aria-invalid', 'true')
  } else {
    spec.error.textContent = ''
    spec.error.hidden = true
    spec.input.removeAttribute('aria-invalid')
  }
}

function showStatus(message: string, retry: boolean): void {
  if (!formStatus || !formStatusText || !retryButton) return
  formStatus.hidden = false
  formStatusText.textContent = message
  retryButton.hidden = !retry
  formStatus.focus({ preventScroll: false })
}

function resetStatus(): void {
  if (!formStatus) return
  formStatus.hidden = true
  if (retryButton) retryButton.hidden = true
}

function finishError(): void {
  formError = true
  sending = false
  form?.removeAttribute('aria-busy')
  form?.classList.add('is-error')
  form?.classList.remove('is-sent')
  if (submitButton) {
    submitButton.disabled = false
    submitButton.textContent = 'Request a briefing'
  }
  showStatus('Request not sent. Check the connection and try again.', true)
}

function finishSuccess(): void {
  submitted = true
  sending = false
  form?.removeAttribute('aria-busy')
  form?.classList.remove('is-error')
  form?.classList.add('is-sent')
  if (fieldsWrap) fieldsWrap.hidden = true
  if (submitButton) submitButton.hidden = true
  showStatus('Request received. We will be in touch.', false)
}

async function sendBriefing(): Promise<void> {
  if (sending || submitted) return
  const invalid = fieldSpecs
    .map((spec) => {
      const message = spec.validate(spec.input?.value ?? '')
      setFieldError(spec, message)
      return message ? { spec, message } : null
    })
    .filter((entry): entry is { spec: FieldSpec; message: string } => entry !== null)

  if (invalid.length > 0) {
    formError = true
    resetStatus()
    invalid[0].spec.input?.focus()
    return
  }

  sending = true
  formError = false
  form?.setAttribute('aria-busy', 'true')
  form?.classList.remove('is-error', 'is-sent')
  if (submitButton) {
    submitButton.disabled = true
    submitButton.textContent = 'Sending...'
  }
  showStatus('Sending request.', false)

  const payload = {
    name: $('#field-name') instanceof HTMLInputElement ? ($('#field-name') as HTMLInputElement).value.trim() : '',
    organization:
      $('#field-org') instanceof HTMLInputElement ? ($('#field-org') as HTMLInputElement).value.trim() : '',
    email:
      $('#field-email') instanceof HTMLInputElement ? ($('#field-email') as HTMLInputElement).value.trim() : '',
    message:
      $('#field-message') instanceof HTMLTextAreaElement
        ? ($('#field-message') as HTMLTextAreaElement).value.trim()
        : '',
  }

  const endpoint = (import.meta.env.VITE_BRIEFING_ENDPOINT ?? '').trim()

  if (!endpoint) {
    if (import.meta.env.DEV) {
      window.setTimeout(finishSuccess, 600)
    } else {
      finishError()
    }
    return
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Request failed with ${response.status}`)
    finishSuccess()
  } catch (error) {
    console.warn('Briefing request failed.', error)
    finishError()
  } finally {
    window.clearTimeout(timeout)
  }
}

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  void sendBriefing()
})

fieldSpecs.forEach((spec) => {
  spec.input?.addEventListener('input', () => {
    if (spec.input?.getAttribute('aria-invalid') === 'true') setFieldError(spec, null)
    if (formError) {
      formError = false
      resetStatus()
    }
  })
})

retryButton?.addEventListener('click', () => {
  resetStatus()
  void sendBriefing()
})

/* --------------------------------------------------------------------- hud */

function updateClock(): void {
  if (!hudUtc) return
  const now = new Date()
  hudUtc.textContent = `${String(now.getUTCHours()).padStart(2, '0')}:${String(
    now.getUTCMinutes(),
  ).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}Z`
}
updateClock()
window.setInterval(updateClock, 1000)

window.setInterval(() => {
  if (!scene) return
  const readout = scene.readout()
  if (hudLat) hudLat.textContent = readout.lat
  if (hudLon) hudLon.textContent = readout.lon
  if (hudTracks) hudTracks.textContent = readout.tracks
}, 350)

/* ----------------------------------------------------------------- reduced */

function initReducedSections(): void {
  const sections = $$<HTMLElement>('[data-chapter]')
  let ticking = false
  const update = (): void => {
    ticking = false
    const mid = window.innerHeight * 0.42
    let active = 0
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= mid) {
        active = Number(section.dataset.chapter ?? 0)
      }
    })
    scene?.setChapter(active)
    setRail(active === 0 ? 0 : Math.min(5, active))
    setMeter(1, Math.min(5, active))
  }
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    },
    { passive: true },
  )
  update()
}

/* -------------------------------------------------------------------- boot */

async function boot(): Promise<void> {
  try {
    await document.fonts.ready
  } catch {
    // Fonts are local; continue with the fallback metrics.
  }

  if (!scene) {
    updateChrome(0)
    return
  }

  if (reduced) {
    root.classList.add('motion-ready')
    initReducedSections()
    return
  }

  try {
    const linesByChapter = chapters.map((chapter) =>
      $$<HTMLElement>('[data-split]', chapter).flatMap((heading) => splitHeading(heading)),
    )
    buildMotion(linesByChapter)
    ScrollTrigger.refresh()
  } catch (error) {
    console.warn('Motion setup failed; falling back to stacked chapters.', error)
    ScrollTrigger.getAll().forEach((trigger) => trigger.kill())
    lenis?.destroy()
    lenis = null
    root.classList.remove('has-gl', 'motion-ready')
    restoreHeadings()
    scene?.destroy()
    scene = null
    pinTrigger = null
    masterTimeline = null
  }
}

void boot()

let resizeTimer = 0
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    scene?.resize()
    ScrollTrigger.refresh()
  }, 180)
})

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__celestracDebug = {
    pinTrigger: () => pinTrigger,
    timeline: () => masterTimeline,
    chrome: (progress: number) => updateChrome(progress),
    scene: () => scene,
    lenis: () => lenis,
    refresh: () => ScrollTrigger.refresh(),
  }
}

// Read-only build telemetry, useful when checking tier behaviour.
try {
  Object.defineProperty(window, '__celestrac', {
    value: {
      get tier() {
        return scene?.tier ?? 'none'
      },
      get chapter() {
        return currentChapter()
      },
      get tracks() {
        return scene?.readout().tracks ?? '000'
      },
    },
  })
} catch {
  // Ignore engines that refuse the property.
}
