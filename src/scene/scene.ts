import {
  Color,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { Sky } from './sky'
import { Globe } from './globe'
import { Orbits } from './orbits'
import { Hardware, type PartKey } from './hardware'
import { Overlays, type MissionMode } from './overlays'
import { degradeQuality, detectQuality, type Quality } from './quality'

export interface Readout {
  lat: string
  lon: string
  tracks: string
}

export interface SceneHandle {
  setProgress(progress: number): void
  setContact(progress: number): void
  setChapter(index: number): void
  setMode(mode: MissionMode, immediate?: boolean): void
  setReduced(value: boolean): void
  resize(): void
  readout(): Readout
  destroy(): void
  readonly quality: Quality
  readonly tier: string
}

interface Pose {
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
}

const DESKTOP: Pose[] = [
  { pos: [0.15, 0.6, 8.8], target: [-2.0, -0.12, 0], fov: 42 },
  { pos: [-0.15, 0.45, 7.4], target: [-1.65, -0.05, 0], fov: 41 },
  { pos: [1.3, 0.55, 5.2], target: [1.25, -0.02, 0], fov: 42 },
  { pos: [0.1, 0.4, 7.8], target: [-1.7, -0.05, 0], fov: 42 },
  { pos: [0, 1.0, 17], target: [0, -2.2, 0], fov: 45 },
  { pos: [0, 0.1, 4.4], target: [0, 1.35, 0], fov: 44 },
]

const DESKTOP_NARROW: Pose[] = [
  { pos: [0.15, 0.6, 8.8], target: [-1.8, -0.12, 0], fov: 42 },
  { pos: [-0.15, 0.45, 7.8], target: [-1.55, -0.05, 0], fov: 41 },
  { pos: [1.3, 0.55, 5.2], target: [1.25, -0.02, 0], fov: 42 },
  { pos: [0.1, 0.4, 8.2], target: [-1.7, -0.05, 0], fov: 42 },
  { pos: [0, 1.0, 17], target: [0, -2.2, 0], fov: 45 },
  { pos: [0, 0.1, 4.4], target: [0, 1.35, 0], fov: 44 },
]

const TABLET: Pose[] = [
  { pos: [0, 0.5, 14], target: [-2.8, -0.2, 0], fov: 42 },
  { pos: [-0.1, 0.4, 13.5], target: [-2.6, -0.2, 0], fov: 42 },
  { pos: [1.0, 0.5, 8.5], target: [1.0, -0.12, 0], fov: 42 },
  { pos: [0, 0.4, 14], target: [-2.8, -0.15, 0], fov: 42 },
  { pos: [0, 0.8, 18], target: [0, -3.9, 0], fov: 46 },
  { pos: [0, -0.4, 6], target: [0, 1.7, 0], fov: 46 },
]

const MOBILE: Pose[] = [
  { pos: [0, 0.5, 12.8], target: [0, -2.6, 0], fov: 46 },
  { pos: [0, 0.5, 15], target: [0, -3.4, 0], fov: 46 },
  { pos: [2.15, 0.5, 6.8], target: [2.15, -1.0, 0], fov: 42 },
  { pos: [0, 0.5, 15], target: [0, -3.4, 0], fov: 46 },
  { pos: [0, 0.8, 15.5], target: [0, -3.2, 0], fov: 48 },
  { pos: [0, 0, 4.6], target: [0, 1.5, 0], fov: 46 },
]

const clamp = (value: number): number => Math.min(1, Math.max(0, value))
const smooth = (value: number): number => {
  const t = clamp(value)
  return t * t * (3 - 2 * t)
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const mix = (x: number, y: number) => x + (y - x) * t
  return {
    pos: [mix(a.pos[0], b.pos[0]), mix(a.pos[1], b.pos[1]), mix(a.pos[2], b.pos[2])],
    target: [
      mix(a.target[0], b.target[0]),
      mix(a.target[1], b.target[1]),
      mix(a.target[2], b.target[2]),
    ],
    fov: mix(a.fov, b.fov),
  }
}

function signed(value: number, whole: number): string {
  const body = Math.abs(value).toFixed(2).padStart(whole + 3, '0')
  return `${value >= 0 ? '+' : '-'}${body}`
}

export function createScene(canvas: HTMLCanvasElement, reduced = false): SceneHandle | null {
  let quality = detectQuality()
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: quality.tier === 'high',
      alpha: false,
      powerPreference: 'high-performance',
    })
  } catch {
    return null
  }

  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(new Color(0x191939), 1)
  renderer.setPixelRatio(quality.dpr)
  renderer.setSize(window.innerWidth, window.innerHeight, false)

  const scene = new Scene()
  const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200)
  const sky = new Sky(quality.stars, quality.dpr)
  const globe = new Globe(quality.globeDots, quality.dpr)
  const orbits = new Orbits(
    quality.orbitCount,
    quality.satelliteCount,
    quality.reticleCount,
    quality.dpr,
  )
  const hardware = new Hardware()
  const overlays = new Overlays()

  hardware.group.position.set(2.15, 0, 0)
  const planet = new Group()
  planet.add(globe.group, orbits.group, overlays.group)
  scene.add(sky.object)
  scene.add(planet)
  scene.add(hardware.group)

  let progress = 0
  let contact = 0
  let reducedMode = reduced
  let layout: 'desktop' | 'tablet' | 'mobile' = 'desktop'
  let running = false
  let visible = !document.hidden
  let raf = 0
  let last = performance.now()
  let elapsed = 0

  let warmup = 0
  let sampleCount = 0
  let sampleTotal = 0
  let measured = false
  let destroyed = false

  const callouts = Array.from(document.querySelectorAll<HTMLElement>('.callout')).map((el) => ({
    el,
    key: (el.dataset.part ?? 'bus') as PartKey,
    label: el.querySelector<HTMLElement>('.callout__label'),
    line: el.querySelector<HTMLElement>('.callout__line'),
  }))
  const anchor = new Vector3()
  const projected = new Vector3()

  document.documentElement.dataset.tier = quality.tier

  function applyLayout(): void {
    const width = window.innerWidth
    layout = width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop'
    sky.setLayout(layout === 'mobile')
    hardware.group.scale.setScalar(layout === 'mobile' ? 0.38 : layout === 'tablet' ? 0.45 : 0.6)
    hardware.group.rotation.set(0.12, layout === 'mobile' ? 1.05 : 0.55, 0)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight, false)
  }

  applyLayout()

  function poses(): Pose[] {
    if (layout === 'mobile') return MOBILE
    if (layout === 'tablet') return TABLET
    if (window.innerWidth < 1280) return DESKTOP_NARROW
    return DESKTOP
  }

  function updateCamera(): void {
    const set = poses()
    let pose: Pose
    if (progress >= 0.999) {
      pose = lerpPose(set[4], set[5], smooth(contact))
    } else {
      const float = clamp(progress) * 5
      const index = Math.min(4, Math.floor(float))
      const local = float - index
      const t = local > 0.7 ? smooth((local - 0.7) / 0.3) : 0
      pose = lerpPose(set[index], set[Math.min(4, index + 1)], t)
    }

    camera.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
    if (Math.abs(camera.fov - pose.fov) > 0.001) {
      camera.fov = pose.fov
      camera.updateProjectionMatrix()
    }
  }

  function updateCallouts(): void {
    if (!hardware.group.visible) return
    const width = window.innerWidth
    const height = window.innerHeight
    const mobile = width < 640

    callouts.forEach(({ el, key, label, line }) => {
      if (!label) return
      hardware.getAnchor(key, anchor)
      projected.copy(anchor).project(camera)
      const ax = (projected.x * 0.5 + 0.5) * width
      const ay = (-projected.y * 0.5 + 0.5) * height
      const labelWidth = Math.max(label.offsetWidth, label.scrollWidth) || 96
      const labelHeight = label.offsetHeight || 18

      let x = ax
      let y = ay
      if (key === 'antenna') {
        x = ax + 46
        y = ay - labelHeight - 16
      } else if (key === 'array') {
        x = ax - labelWidth / 2
        y = ay - labelHeight - 26
      } else if (key === 'payload') {
        x = ax - labelWidth / 2
        y = ay + 50
      } else if (key === 'bus') {
        x = ax - labelWidth - 56
        y = ay + 130
      }

      if (mobile) {
        if (key === 'antenna') {
          x = ax + 14
          y = ay - labelHeight - 24
        } else if (key === 'array') {
          x = ax - labelWidth / 2
          y = ay - labelHeight - 22
        } else if (key === 'payload') {
          x = ax - labelWidth / 2
          y = ay + 30
        } else if (key === 'bus') {
          x = ax - labelWidth - 16
          y = ay + 40
        }
      }

      const rightMargin = width >= 640 && width < 1024 ? 60 : 28
      x = Math.min(width - labelWidth - rightMargin, Math.max(12, x))
      y = Math.min(height - labelHeight - 12, Math.max(72, y))

      label.style.left = `${Math.round(x)}px`
      label.style.top = `${Math.round(y)}px`

      if (line && !mobile) {
        const lx = Math.min(x + labelWidth, Math.max(x, ax))
        const ly = Math.min(y + labelHeight, Math.max(y, ay))
        const dx = lx - ax
        const dy = ly - ay
        const distance = Math.hypot(dx, dy)
        line.style.left = `${Math.round(ax)}px`
        line.style.top = `${Math.round(ay)}px`
        line.style.width = `${Math.round(Math.max(0, distance - 6))}px`
        line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`
      }

      el.style.visibility =
        projected.z > 1 || ay < -80 || ay > height + 80 ? 'hidden' : 'visible'
    })
  }

  function applyState(): void {
    const float = clamp(progress) * 5
    const hwIn = smooth((float - 1.72) / 0.28)
    const hwOut = 1 - smooth((float - 2.82) / 0.32)
    const hardwareWeight = progress >= 0.999 ? 0 : hwIn * hwOut

    hardware.setOpacity(hardwareWeight)
    hardware.setExplode(progress >= 0.999 ? 1 : smooth((progress - 0.43) / 0.08))

    planet.position.x = -1.15 * hardwareWeight
    planet.scale.setScalar(1 - 0.22 * hardwareWeight)
    globe.setOpacity(1 - 0.6 * hardwareWeight)
    orbits.setOpacity(1 - 0.9 * hardwareWeight)

    const overlayWeight =
      smooth((progress - 0.54) / 0.06) * (1 - smooth((progress - 0.74) / 0.06))
    overlays.setChapterWeight(progress >= 0.999 ? 0 : overlayWeight)
    orbits.setLoopProgress(progress >= 0.799 ? clamp((progress - 0.8) / 0.2) : null)
  }

  function renderFrame(dt: number): void {
    if (destroyed) return

    if (!reducedMode) elapsed += dt
    sky.update(elapsed, reducedMode ? 0 : 1)
    globe.update(dt, !reducedMode)
    orbits.update(reducedMode ? 0 : elapsed)
    overlays.update(reducedMode ? 0 : elapsed)
    applyState()
    updateCamera()
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld()
    updateCallouts()
    renderer.render(scene, camera)
  }

  function start(): void {
    if (running || reducedMode || destroyed) return
    running = true
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }

  function stop(): void {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  function frame(now: number): void {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (!visible) return

    const raw = (now - last) / 1000
    last = now
    const dt = Math.min(0.05, Math.max(0, raw))
    renderFrame(dt)

    if (!measured) {
      if (warmup < 20) {
        warmup += 1
      } else {
        sampleCount += 1
        sampleTotal += raw * 1000
        if (sampleCount >= 60) {
          measured = true
          const mean = sampleTotal / sampleCount
          if (mean > 24) {
            quality = degradeQuality(quality)
            renderer.setPixelRatio(quality.dpr)
            renderer.setSize(window.innerWidth, window.innerHeight, false)
            sky.setPixelRatio(quality.dpr)
            sky.setCount(quality.stars)
            globe.setPixelRatio(quality.dpr)
            globe.setCount(quality.globeDots)
            orbits.setPixelRatio(quality.dpr)
            orbits.setCount(quality.orbitCount, quality.satelliteCount, quality.reticleCount)
            document.documentElement.dataset.tier = quality.tier
          }
        }
      }
    }
  }

  function handleVisibility(): void {
    visible = !document.hidden
    if (visible) {
      last = performance.now()
      start()
      if (reducedMode) renderFrame(0)
    } else {
      stop()
    }
  }

  document.addEventListener('visibilitychange', handleVisibility)
  if (reducedMode) renderFrame(0)
  else start()

  const handle: SceneHandle = {
    setProgress(value: number): void {
      progress = clamp(value)
      if (reducedMode) renderFrame(0)
    },
    setContact(value: number): void {
      contact = clamp(value)
      if (reducedMode) renderFrame(0)
    },
    setChapter(index: number): void {
      if (index >= 5) {
        progress = 1
        contact = 1
      } else {
        progress = (Math.max(0, index) + 0.5) / 5
        contact = 0
      }
      if (reducedMode) renderFrame(0)
    },
    setMode(mode: MissionMode, immediate = false): void {
      overlays.setMode(mode, immediate)
      if (reducedMode) renderFrame(0)
    },
    setReduced(value: boolean): void {
      reducedMode = value
      if (value) {
        stop()
        renderFrame(0)
      } else {
        start()
      }
    },
    resize(): void {
      applyLayout()
      if (reducedMode) renderFrame(0)
    },
    readout(): Readout {
      const length = camera.position.length() || 1
      const lat = (Math.asin(camera.position.y / length) * 180) / Math.PI
      const lon = (Math.atan2(camera.position.z, camera.position.x) * 180) / Math.PI
      return {
        lat: signed(lat, 2),
        lon: signed(lon, 3),
        tracks: String(quality.satelliteCount + overlays.trackCount()).padStart(3, '0'),
      }
    },
    destroy(): void {
      destroyed = true
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
      sky.dispose()
      globe.dispose()
      orbits.dispose()
      hardware.dispose()
      overlays.dispose()
      renderer.dispose()
    },
    get quality(): Quality {
      return quality
    },
    get tier(): string {
      return quality.tier
    },
  }

  return handle
}
