import './fonts.css'
import './styles.css'

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import type { SceneHandle, ViewKey } from './scene/scene'
import type { MissionMode } from './scene/overlays'

gsap.registerPlugin(ScrollTrigger)

const root = document.documentElement
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = <T extends Element>(selector: string, scope: ParentNode = document): T | null =>
  scope.querySelector<T>(selector)
const $$ = <T extends Element>(selector: string, scope: ParentNode = document): T[] =>
  Array.from(scope.querySelectorAll<T>(selector))

root.classList.toggle('reduced', reduced)
root.classList.add('motion-ready')

const SECTIONS = ['hero', 'orrery', 'tycho', 'products', 'missions', 'contact'] as const

let scene: SceneHandle | null = null
let lenis: Lenis | null = null
let triggersReady = false
const clamp = (v: number): number => Math.min(1, Math.max(0, v))
const smooth = (v: number): number => {
  const t = clamp(v)
  return t * t * (3 - 2 * t)
}

/* ------------------------------------------------------------------ chrome */

const header = $<HTMLElement>('.site-header')
const navLinks = $$<HTMLAnchorElement>('.nav__links a')

function setStuck(): void {
  header?.classList.toggle('is-stuck', window.scrollY > 16)
}
setStuck()
window.addEventListener('scroll', setStuck, { passive: true })

function setNav(id: string): void {
  navLinks.forEach((link) => {
    link.setAttribute('aria-current', link.getAttribute('href') === `#${id}` ? 'true' : 'false')
  })
}

function setReading(value: boolean): void {
  root.classList.toggle('is-reading', value)
}

/* -------------------------------------------------------------------- menu */

const menu = $<HTMLElement>('#mobile-menu')
const menuOpenButton = $<HTMLButtonElement>('#menu-open')
const menuCloseButton = $<HTMLButtonElement>('#menu-close')
let menuOpen = false
let previousFocus: HTMLElement | null = null

function focusables(): HTMLElement[] {
  if (!menu) return []
  return $$<HTMLElement>('a[href], button:not([disabled])', menu).filter(
    (element) => element.offsetParent !== null,
  )
}

function openMenu(): void {
  if (!menu || !menuOpenButton) return
  menuOpen = true
  previousFocus = document.activeElement as HTMLElement | null
  menu.hidden = false
  menuOpenButton.setAttribute('aria-expanded', 'true')
  document.body.style.overflow = 'hidden'
  lenis?.stop()
  menuCloseButton?.focus()
  document.addEventListener('keydown', onMenuKeydown, true)
}

function closeMenu(restore = true): void {
  if (!menu || !menuOpenButton) return
  menuOpen = false
  menu.hidden = true
  menuOpenButton.setAttribute('aria-expanded', 'false')
  document.body.style.overflow = ''
  lenis?.start()
  document.removeEventListener('keydown', onMenuKeydown, true)
  if (restore) previousFocus?.focus()
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (!menuOpen) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    return
  }
  if (event.key !== 'Tab') return
  const list = focusables()
  if (list.length === 0) return
  const first = list[0]
  const last = list[list.length - 1]
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

/* --------------------------------------------------------------- navigation */

function headerOffset(): number {
  return window.innerWidth < 768 ? 58 : 64
}

function scrollToSection(id: string): void {
  const target = document.getElementById(id)
  if (!target) return
  const y = target.getBoundingClientRect().top + window.scrollY - headerOffset()
  if (lenis) {
    lenis.scrollTo(Math.max(0, y), { duration: 1.05 })
  } else {
    window.scrollTo({ top: Math.max(0, y), behavior: reduced ? 'auto' : 'smooth' })
  }
}

document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
  if (!link) return
  const id = link.getAttribute('href')?.slice(1)
  if (!id || !document.getElementById(id)) return
  event.preventDefault()
  if (menuOpen) closeMenu(false)
  scrollToSection(id)
  const heading = document.getElementById(id)?.querySelector<HTMLElement>('h1, h2')
  window.setTimeout(() => {
    heading?.setAttribute('tabindex', '-1')
    heading?.focus({ preventScroll: true })
  }, 700)
})

document.addEventListener('keydown', (event) => {
  if (menuOpen) return
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="radio"]')) return

  const active = SECTIONS.findIndex((id) => {
    const el = document.getElementById(id)
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return rect.top <= headerOffset() + 8 && rect.bottom > headerOffset() + 8
  })
  const index = active === -1 ? 0 : active

  if (event.key === 'PageDown' || event.key === 'ArrowDown') {
    event.preventDefault()
    scrollToSection(SECTIONS[Math.min(SECTIONS.length - 1, index + 1)])
  } else if (event.key === 'PageUp' || event.key === 'ArrowUp') {
    event.preventDefault()
    scrollToSection(SECTIONS[Math.max(0, index - 1)])
  } else if (event.key === 'Home') {
    event.preventDefault()
    scrollToSection('hero')
  } else if (event.key === 'End') {
    event.preventDefault()
    scrollToSection('contact')
  }
})

/* The mobile track sheet covers the page, so it owns the scroll while open. */
document.addEventListener('celestrac:sheet', (event) => {
  const open = Boolean((event as CustomEvent<{ open: boolean }>).detail?.open)
  // Lock the document element too: body overflow alone does not stop the page
  // scrolling when the root's own overflow is set.
  document.documentElement.style.overflow = open ? 'hidden' : ''
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) lenis?.stop()
  else lenis?.start()
})

/* ----------------------------------------------------------------- missions */

const modeButtons = $$<HTMLButtonElement>('[data-mode]')
const modeLabel = $<HTMLElement>('#mode-label')

function selectMode(mode: MissionMode, focus = false): void {
  modeButtons.forEach((button) => {
    const checked = button.dataset.mode === mode
    button.classList.toggle('is-on', checked)
    button.setAttribute('aria-checked', String(checked))
    button.tabIndex = checked ? 0 : -1
    if (checked && focus) button.focus()
  })
  if (modeLabel) modeLabel.textContent = mode
  scene?.setMode(mode)
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

/* --------------------------------------------------------------------- form */

const form = $<HTMLFormElement>('#briefing-form')
const fieldsWrap = $<HTMLElement>('#briefing-fields')
const submitButton = $<HTMLButtonElement>('.form__submit')
const formStatus = $<HTMLElement>('#form-status')
const formStatusText = $<HTMLElement>('#form-status-text')
const retryButton = $<HTMLButtonElement>('#form-retry')

interface FieldSpec {
  input: HTMLInputElement | HTMLTextAreaElement | null
  error: HTMLElement | null
  validate: (value: string) => string | null
}

const required = (message: string) => (value: string) => (value.trim() ? null : message)

const fieldSpecs: FieldSpec[] = [
  {
    input: $<HTMLInputElement>('#field-name'),
    error: $<HTMLElement>('#error-name'),
    validate: required('Enter your name.'),
  },
  {
    input: $<HTMLInputElement>('#field-org'),
    error: $<HTMLElement>('#error-org'),
    validate: required('Enter your organization.'),
  },
  {
    input: $<HTMLInputElement>('#field-email'),
    error: $<HTMLElement>('#error-email'),
    validate: (value) => {
      if (!value.trim()) return 'Enter your work email.'
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : 'Enter a valid work email.'
    },
  },
  {
    input: $<HTMLTextAreaElement>('#field-message'),
    error: $<HTMLElement>('#error-message'),
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

function finishUnavailable(): void {
  formError = true
  sending = false
  form?.removeAttribute('aria-busy')
  form?.classList.add('is-error')
  if (submitButton) {
    submitButton.disabled = false
    submitButton.textContent = 'Request a briefing'
  }
  showStatus('Requests are not being delivered right now. Nothing was sent.', false)
}

function finishError(
  message = 'Request not sent. Check the connection and try again.',
): void {
  formError = true
  sending = false
  form?.removeAttribute('aria-busy')
  form?.classList.add('is-error')
  form?.classList.remove('is-sent')
  if (submitButton) {
    submitButton.disabled = false
    submitButton.textContent = 'Request a briefing'
  }
  showStatus(message, true)
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
    submitButton.textContent = 'Sending'
  }
  showStatus('Sending request.', false)

  const payload = {
    name: ($<HTMLInputElement>('#field-name')?.value ?? '').trim(),
    org: ($<HTMLInputElement>('#field-org')?.value ?? '').trim(),
    email: ($<HTMLInputElement>('#field-email')?.value ?? '').trim(),
    message: ($<HTMLTextAreaElement>('#field-message')?.value ?? '').trim(),
    company_url: ($<HTMLInputElement>('#field-company-url')?.value ?? '').trim(),
  }

  const endpoint = (import.meta.env.VITE_BRIEFING_ENDPOINT ?? '/api/briefing').trim()

  // Local development without the function running: keep the flow testable and
  // never let this path exist in a production build.
  if (import.meta.env.DEV && !import.meta.env.VITE_BRIEFING_ENDPOINT) {
    window.setTimeout(() => finishUnavailable(), 500)
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
    if (response.status === 503) {
      finishUnavailable()
      return
    }
    if (response.status === 429) {
      finishError('Too many requests from this connection. Try again shortly.')
      return
    }
    if (!response.ok) throw new Error(`Request failed with ${response.status}`)
    finishSuccess()
  } catch (error) {
    if (import.meta.env.DEV) console.warn('Briefing request failed.', error)
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

/* ------------------------------------------------------------------- orrery */

let orreryReady = false
function initOrreryOnce(): void {
  if (orreryReady) return
  const frame = document.getElementById('orrery-frame')
  if (!frame) return
  orreryReady = true
  void import('./orrery').then(({ initOrrery }) => {
    initOrrery()
  })
}

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          initOrreryOnce()
          observer.disconnect()
        }
      })
    },
    { rootMargin: '320px 0px' },
  )
  const frame = document.getElementById('orrery-frame')
  if (frame) observer.observe(frame)
} else {
  initOrreryOnce()
}

/* -------------------------------------------------------------------- scene */

function stageTrigger(selector: string, view: ViewKey): void {
  const el = document.querySelector(selector)
  if (!el) return
  ScrollTrigger.create({
    trigger: el,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => scene?.setView(view, self.progress),
    onRefresh: (self) => scene?.setView(view, self.progress),
  })
}

function sectionTrigger(selector: string, id: string, reading: boolean): void {
  const el = document.querySelector(selector)
  if (!el) return
  ScrollTrigger.create({
    trigger: el,
    start: 'top 60%',
    end: 'bottom 40%',
    onEnter: () => {
      setNav(id)
      setReading(reading)
      if (reading) scene?.setView('quiet', 0.4)
    },
    onEnterBack: () => {
      setNav(id)
      setReading(reading)
      if (reading) scene?.setView('quiet', 0.4)
    },
    onLeave: () => setReading(false),
  })
}

function setupTriggers(): void {
  if (triggersReady) return
  triggersReady = true

  stageTrigger('#hero', 'hero')
  stageTrigger('#tycho', 'hardware')

  const hardware = document.querySelector('#tycho')
  if (hardware) {
    ScrollTrigger.create({
      trigger: hardware,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => {
        const p = self.progress
        // Fade in only: the object must still be there at the end of the pin,
        // where the next section takes over.
        const weight = Math.min(1, p / 0.05)
        const explode = smooth((p - 0.12) / 0.62)
        scene?.setView('hardware', p)
        scene?.setHardware(weight, explode)
      },
      onRefresh: (self) => {
        const p = self.progress
        scene?.setHardware(Math.min(1, p / 0.05), smooth((p - 0.12) / 0.62))
      },
    })
  }

  // Mission overlay: fades in with the overlay window, camera settles on the globe.
  const windowEl = document.querySelector('.missions__window')
  if (windowEl) {
    ScrollTrigger.create({
      trigger: windowEl,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => {
        const p = self.progress
        scene?.setOverlay(smooth(p / 0.35) * smooth((1 - p) / 0.25))
      },
      onRefresh: () => scene?.setOverlay(0),
    })
  }

  sectionTrigger('#orrery', 'orrery', true)
  sectionTrigger('#products', 'products', true)
  sectionTrigger('#missions', 'missions', false)
  sectionTrigger('#contact', 'contact', true)

  if (!reduced) {
    // The one scan wipe, hero to Orrery: a sweep that becomes the picture.
    gsap.fromTo(
      '#orrery',
      { clipPath: 'inset(0% 0% 100% 0%)' },
      {
        clipPath: 'inset(0% 0% 0% 0%)',
        ease: 'none',
        scrollTrigger: { trigger: '#orrery', start: 'top bottom', end: 'top 42%', scrub: 0.6 },
      },
    )

    // Headline masks. One element at a time, body copy never moves.
    $$<HTMLElement>('h2').forEach((heading) => {
      gsap.fromTo(
        heading,
        { clipPath: 'inset(0% 0% 100% 0%)' },
        {
          clipPath: 'inset(0% 0% -12% 0%)',
          duration: 0.9,
          ease: 'power3.out',
          scrollTrigger: { trigger: heading, start: 'top 88%', once: true },
        },
      )
    })
  }

  ScrollTrigger.refresh()
}

function startDebug(): void {
  const box = document.createElement('div')
  box.id = 'debug'
  box.setAttribute('aria-hidden', 'true')
  document.body.appendChild(box)
  const update = (): void => {
    if (!scene) return
    const stats = scene.stats()
    box.textContent = `calls ${stats.calls} · tris ${Math.round(stats.triangles / 1000)}k · ${stats.ms.toFixed(1)} ms · ${stats.tier}`
    box.classList.toggle('is-over', stats.calls > 100)
  }
  update()
  window.setInterval(update, 250)
}

function loadScene(): void {
  const canvas = document.getElementById('stage-canvas')
  if (!(canvas instanceof HTMLCanvasElement)) return
  void import('./scene/scene')
    .then(({ createScene }) => {
      const created = createScene(canvas, reduced)
      if (!created) return
      scene = created
      root.classList.add('has-gl')
      created.resize()
      created.setMode('civil')
      setupTriggers()

      // Dropped from production builds entirely.
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('debug') === '1') {
        startDebug()
      }

      if (reduced) initReducedScene()
    })
    .catch((error) => console.warn('Scene unavailable; the poster frame stays.', error))
}

/* Reduced motion: static poses, no pins, no flow. */
function initReducedScene(): void {
  const stages: Array<[string, ViewKey]> = [
    ['#hero', 'hero'],
    ['#orrery', 'quiet'],
    ['#tycho', 'hardware'],
    ['#products', 'quiet'],
    ['#missions', 'missions'],
    ['#contact', 'quiet'],
  ]
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const id = entry.target.id
        if (id === 'hero') scene?.setView('hero', 0.35)
        if (id === 'orrery' || id === 'products') {
          scene?.setHardware(0, 0)
          scene?.setView('quiet', 0.5)
        }
        if (id === 'tycho') {
          scene?.setView('hardware', 0.5)
          scene?.setHardware(1, 1)
        }
        if (id === 'missions') {
          scene?.setHardware(0, 0)
          scene?.setView('missions', 0.4)
          scene?.setOverlay(1)
        }
        if (id === 'contact') {
          scene?.setOverlay(0)
          scene?.setView('quiet', 0.6)
        }
      })
    },
    { threshold: 0.45 },
  )
  stages.forEach(([selector]) => {
    const el = document.querySelector(selector)
    if (el) observer.observe(el)
  })
  scene?.setHardware(0, 0)
  scene?.setView('hero', 0.35)
}

/* ------------------------------------------------------------------- boot */

function bootMotion(): void {
  if (reduced) {
    setReading(false)
    return
  }

  gsap.set('.hero__title .line > span', { yPercent: 105 })
  requestAnimationFrame(() => {
    gsap.to('.hero__title .line > span', {
      yPercent: 0,
      duration: 1.05,
      stagger: 0.08,
      ease: 'expo.out',
      delay: 0.12,
    })
  })

  const finePointer = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)')
    .matches
  if (!finePointer) return

  lenis = new Lenis({ lerp: 0.1 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000)
  })
  gsap.ticker.lagSmoothing(0)
}

async function boot(): Promise<void> {
  try {
    await document.fonts.ready
  } catch {
    // Fonts are local; continue with fallback metrics.
  }

  bootMotion()
  requestAnimationFrame(() => window.setTimeout(loadScene, 0))
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
    scene: () => scene,
    refresh: () => ScrollTrigger.refresh(),
    mode: (mode: MissionMode) => selectMode(mode),
  }
}
