import { landRings } from './land'
import { TRACKS, ageLabel, footprintFor, type Track } from './orrery-data'

/**
 * The Orrery proof: DOM table + 2D canvas map + detail drawer.
 * No WebGL here, so it stays crisp and cheap on every tier.
 */

const DATA = 'rgba(111, 184, 230, 0.72)'
const ACTION = '#ecb44d'
const RULE = 'rgba(242, 225, 153, 0.14)'

export function initOrrery(): () => void {
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')
  const tbody = document.querySelector<HTMLTableSectionElement>('#tracks-body')
  const drawer = document.querySelector<HTMLElement>('#track-drawer')
  const drawerId = document.querySelector<HTMLElement>('#drawer-id')
  const drawerTitle = document.querySelector<HTMLElement>('#drawer-title')
  const drawerFacts = document.querySelector<HTMLElement>('#drawer-facts')
  const drawerLife = document.querySelector<HTMLElement>('#drawer-life')
  const drawerClose = document.querySelector<HTMLButtonElement>('#drawer-close')
  const count = document.querySelector<HTMLElement>('#track-count')
  if (!canvas || !tbody || !drawer || !drawerId || !drawerTitle || !drawerFacts || !drawerLife) {
    return () => {}
  }

  const drawerEl = drawer
  const idEl = drawerId
  const titleEl = drawerTitle
  const factsEl = drawerFacts
  const lifeEl = drawerLife

  let selected: Track | null = null
  let preview: Track | null = null
  const rows = new Map<string, HTMLTableRowElement>()
  const rings = landRings()

  if (count) count.textContent = `${TRACKS.length} tracks`

  /* ------------------------------------------------------------------ table */

  const fragment = document.createDocumentFragment()
  TRACKS.forEach((track) => {
    const row = document.createElement('tr')
    row.tabIndex = 0
    row.dataset.id = track.id
    row.setAttribute('aria-selected', 'false')
    row.innerHTML = `
      <td>${track.id}</td>
      <td>${track.type}</td>
      <td>${track.source}</td>
      <td>${track.confidence}%</td>
      <td>${ageLabel(track.age)}</td>
    `
    rows.set(track.id, row)
    fragment.appendChild(row)
  })
  tbody.appendChild(fragment)

  const byId = (id: string | undefined): Track | null =>
    TRACKS.find((track) => track.id === id) ?? null

  /* ----------------------------------------------------------------- drawer */

  const facts = (track: Track): string => `
    <div><dt class="annot">Source</dt><dd>${track.source}</dd></div>
    <div><dt class="annot">Confidence</dt><dd>${track.confidence}%</dd></div>
    <div><dt class="annot">Age</dt><dd>${ageLabel(track.age)}</dd></div>
    <div><dt class="annot">Last update</dt><dd>−${ageLabel(track.age)}</dd></div>
  `

  const life = (track: Track): string => {
    let clock = 0
    return track.steps
      .map((step) => {
        clock += step.latency
        return `<li>
          <span class="step-name">${step.name}</span>
          <span class="step-note">${step.note}</span>
          <span class="step-time">+${clock.toFixed(2)} s</span>
        </li>`
      })
      .join('')
  }

  function showTrack(track: Track | null): void {
    if (!track) {
      idEl.textContent = 'Select a track'
      titleEl.textContent = 'No track selected'
      factsEl.innerHTML = ''
      lifeEl.innerHTML = ''
      return
    }
    const active = selected?.id === track.id
    idEl.textContent = `${track.id} · ${active ? 'selected' : 'preview'}`
    titleEl.textContent = track.type
    factsEl.innerHTML = facts(track)
    lifeEl.innerHTML = life(track)
  }

  /** Below this width the drawer is a fixed bottom sheet over the page. */
  const sheetMode = (): boolean => window.matchMedia('(max-width: 767px)').matches

  /**
   * On desktop the drawer is an inline panel that follows the table, so it stays a
   * plain live region. As a bottom sheet it covers the page and becomes a modal
   * dialog, named by the track id and its type.
   */
  function syncSheetRole(open: boolean): void {
    if (open && sheetMode()) {
      drawerEl.setAttribute('role', 'dialog')
      drawerEl.setAttribute('aria-modal', 'true')
      drawerEl.setAttribute('aria-labelledby', 'drawer-id drawer-title')
      drawerEl.removeAttribute('aria-live')
    } else {
      drawerEl.removeAttribute('role')
      drawerEl.removeAttribute('aria-modal')
      drawerEl.removeAttribute('aria-labelledby')
      drawerEl.setAttribute('aria-live', 'polite')
    }
  }

  function select(track: Track | null): void {
    const previous = selected
    const wasOpen = drawerEl.classList.contains('is-open')
    const focusInside = drawerEl.contains(document.activeElement)

    selected = track
    rows.forEach((row, id) => {
      row.setAttribute('aria-selected', String(track?.id === id))
    })
    showTrack(track ?? preview)
    drawerEl.classList.toggle('is-open', Boolean(track))
    // The close control is only reachable while there is something to close.
    if (drawerClose) drawerClose.hidden = !track

    syncSheetRole(Boolean(track))

    const returnTo = previous ? rows.get(previous.id) : undefined
    if (sheetMode()) {
      // A modal sheet: lock the page and take focus, hand both back on close.
      document.dispatchEvent(new CustomEvent('celestrac:sheet', { detail: { open: Boolean(track) } }))
      if (track) {
        // preventScroll: the sheet is fixed, but focusing it would still scroll
        // the document to its position underneath.
        if (!wasOpen) drawerClose?.focus({ preventScroll: true })
      } else {
        returnTo?.focus({ preventScroll: true })
      }
    } else if (!track && focusInside) {
      returnTo?.focus({ preventScroll: true })
    }

    draw()
  }

  function previewTrack(track: Track | null): void {
    preview = track
    if (track) showTrack(track)
    draw()
  }

  /* -------------------------------------------------------------------- map */

  function draw(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = canvas!.clientWidth
    const height = canvas!.clientHeight
    if (width === 0 || height === 0) return

    canvas!.width = Math.round(width * dpr)
    canvas!.height = Math.round(height * dpr)
    const ctx = canvas!.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const worldHeight = Math.min(height, width / 2)
    const worldWidth = worldHeight * 2
    const ox = (width - worldWidth) / 2
    const oy = (height - worldHeight) / 2

    const project = (lon: number, lat: number): [number, number] => [
      ox + ((lon + 180) / 360) * worldWidth,
      oy + ((90 - lat) / 180) * worldHeight,
    ]

    ctx.fillStyle = 'rgba(27, 58, 104, 0.22)'
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = RULE
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, worldWidth, worldHeight)

    // Graticule at 30 degrees.
    ctx.strokeStyle = 'rgba(111, 184, 230, 0.1)'
    ctx.lineWidth = 1
    for (let lon = -150; lon <= 150; lon += 30) {
      const [x] = project(lon, 0)
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, oy)
      ctx.lineTo(Math.round(x) + 0.5, oy + worldHeight)
      ctx.stroke()
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const [, y] = project(0, lat)
      ctx.beginPath()
      ctx.moveTo(ox, Math.round(y) + 0.5)
      ctx.lineTo(ox + worldWidth, Math.round(y) + 0.5)
      ctx.stroke()
    }

    // Coastlines: the same 110m land data as the globe.
    ctx.strokeStyle = 'rgba(111, 184, 230, 0.46)'
    ctx.lineWidth = 0.9
    rings.forEach((ring) => {
      ctx.beginPath()
      let started = false
      for (let i = 0; i < ring.length; i += 1) {
        const [lon, lat] = ring[i]
        if (i > 0 && Math.abs(lon - ring[i - 1][0]) > 40) started = false
        const [x, y] = project(lon, lat)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    })

    // Every track, plotted.
    ctx.fillStyle = DATA
    TRACKS.forEach((track) => {
      const [x, y] = project(track.lon, track.lat)
      ctx.beginPath()
      ctx.arc(x, y, 1.7, 0, Math.PI * 2)
      ctx.fill()
    })

    if (preview && preview.id !== selected?.id) {
      const [x, y] = project(preview.lon, preview.lat)
      ctx.strokeStyle = 'rgba(111, 184, 230, 0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.stroke()
    }

    if (selected) {
      const [x, y] = project(selected.lon, selected.lat)
      const radius = Math.max(14, footprintFor(selected))
      ctx.strokeStyle = ACTION
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x - 9, y)
      ctx.lineTo(x - 3, y)
      ctx.moveTo(x + 3, y)
      ctx.lineTo(x + 9, y)
      ctx.moveTo(x, y - 9)
      ctx.lineTo(x, y - 3)
      ctx.moveTo(x, y + 3)
      ctx.lineTo(x, y + 9)
      ctx.stroke()
      ctx.fillStyle = ACTION
      ctx.beginPath()
      ctx.arc(x, y, 2.4, 0, Math.PI * 2)
      ctx.fill()

      ctx.font = '10px "IBM Plex Mono", monospace'
      ctx.fillStyle = 'rgba(242, 225, 153, 0.9)'
      const labelY = y - radius - 6 > 14 ? y - radius - 6 : y + radius + 14
      ctx.fillText(selected.id, Math.min(width - 58, x + 6), Math.max(14, labelY))
    }
  }

  /* ---------------------------------------------------------------- events */

  const onRowClick = (event: Event): void => {
    const row = (event.target as Element | null)?.closest<HTMLTableRowElement>('tr')
    if (!row) return
    const track = byId(row.dataset.id)
    select(track && track.id === selected?.id ? null : track)
  }

  const onRowOver = (event: Event): void => {
    const row = (event.target as Element | null)?.closest<HTMLTableRowElement>('tr')
    if (!row) return
    const track = byId(row.dataset.id)
    if (track && track.id !== preview?.id) previewTrack(track)
  }

  const onRowLeave = (): void => {
    previewTrack(null)
    showTrack(selected)
  }

  const onRowKey = (event: KeyboardEvent): void => {
    const row = (event.target as Element | null)?.closest<HTMLTableRowElement>('tr')
    if (!row) return
    const list = Array.from(rows.values())
    const index = list.indexOf(row)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = list[index + (event.key === 'ArrowDown' ? 1 : -1)]
      next?.focus()
      const track = next ? byId(next.dataset.id) : null
      if (track) previewTrack(track)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const track = byId(row.dataset.id)
      select(track && track.id === selected?.id ? null : track)
    } else if (event.key === 'Escape') {
      select(null)
      row.focus()
    }
  }

  const onMapClick = (event: MouseEvent): void => {
    const rect = canvas!.getBoundingClientRect()
    const worldHeight = Math.min(rect.height, rect.width / 2)
    const worldWidth = worldHeight * 2
    const ox = (rect.width - worldWidth) / 2
    const oy = (rect.height - worldHeight) / 2
    const lon = ((event.clientX - rect.left - ox) / worldWidth) * 360 - 180
    const lat = 90 - ((event.clientY - rect.top - oy) / worldHeight) * 180
    let best: Track | null = null
    let bestDistance = 26
    for (const track of TRACKS) {
      const dx = ((track.lon - lon + 540) % 360) - 180
      const dy = track.lat - lat
      const distance = Math.hypot(dx * 0.5, dy)
      if (distance < bestDistance) {
        bestDistance = distance
        best = track
      }
    }
    if (best) select(best)
  }

  const onClose = (): void => {
    select(null)
  }

  /** While the sheet is up it is modal, so page-scroll keys must not pass through. */
  const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'])
  const onSheetKey = (event: KeyboardEvent): void => {
    if (!sheetMode() || !drawerEl.classList.contains('is-open')) return

    // Focus trap: the sheet is modal, so Tab cycles inside it.
    if (event.key === 'Tab') {
      const list = Array.from(
        drawerEl.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => element.getClientRects().length > 0)
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (!(active instanceof Node) || !drawerEl.contains(active)) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
      return
    }

    if (!SCROLL_KEYS.has(event.key)) return
    // The page keeps its scrollable overflow while locked, so a bare preventDefault
    // is not enough on its own: the sheet scrolls itself, and the page never moves.
    event.preventDefault()
    if (!drawerEl.contains(event.target as Node)) return
    if (drawerEl.scrollHeight <= drawerEl.clientHeight + 1) return
    const page = drawerEl.clientHeight * 0.9
    if (event.key === 'Home') drawerEl.scrollTop = 0
    else if (event.key === 'End') drawerEl.scrollTop = drawerEl.scrollHeight
    else if (event.key === 'ArrowUp') drawerEl.scrollTop -= 60
    else if (event.key === 'PageUp') drawerEl.scrollTop -= page
    else if (event.key === 'ArrowDown') drawerEl.scrollTop += 60
    else drawerEl.scrollTop += page
  }

  /** Escape closes from anywhere, not only from a focused row. */
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !selected) return
    const row = rows.get(selected.id) ?? null
    const focusWasOutside = document.activeElement === document.body || drawerEl.contains(document.activeElement)
    select(null)
    if (row && focusWasOutside) row.focus()
  }

  const onResize = (): void => {
    // Crossing the breakpoint changes what the drawer is, so re-sync its role.
    syncSheetRole(drawerEl.classList.contains('is-open'))
    draw()
  }

  tbody.addEventListener('click', onRowClick)
  tbody.addEventListener('mouseover', onRowOver)
  tbody.addEventListener('mouseleave', onRowLeave)
  tbody.addEventListener('keydown', onRowKey)
  canvas.addEventListener('click', onMapClick)
  document.addEventListener('keydown', onEscape)
  // Capture phase: the page's own PageDown/End section nav is registered on
  // document earlier, so a bubble-phase guard would run after it scrolled.
  document.addEventListener('keydown', onSheetKey, true)
  drawerClose?.addEventListener('click', onClose)
  window.addEventListener('resize', onResize)

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => draw())
    observer.observe(canvas)
  }

  showTrack(null)
  draw()

  return () => {
    tbody.removeEventListener('click', onRowClick)
    tbody.removeEventListener('mouseover', onRowOver)
    tbody.removeEventListener('mouseleave', onRowLeave)
    tbody.removeEventListener('keydown', onRowKey)
    canvas.removeEventListener('click', onMapClick)
    document.removeEventListener('keydown', onEscape)
    document.removeEventListener('keydown', onSheetKey, true)
    drawerClose?.removeEventListener('click', onClose)
    window.removeEventListener('resize', onResize)
  }
}

export type { Track }
