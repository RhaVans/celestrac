import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Sky } from './sky'
import { Globe } from './globe'
import { Orbits } from './orbits'
import { Hardware } from './hardware'
import { Overlays, type MissionMode } from './overlays'
import { Drafting } from './drafting'
import { degradeQuality, detectQuality, type Quality } from './quality'

export type ViewKey = 'hero' | 'hardware' | 'missions' | 'quiet'

export interface SceneStats {
  calls: number
  triangles: number
  ms: number
  tier: string
}

export interface SceneHandle {
  setView(view: ViewKey, progress: number): void
  setHardware(weight: number, explode: number): void
  setOverlay(weight: number): void
  setMode(mode: MissionMode): void
  resize(): void
  stats(): SceneStats
  destroy(): void
}

interface Pose {
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
}

/* Two pinned stages, then the globe returns for the mission overlay. */
const POSES: Record<ViewKey, [Pose, Pose]> = {
  // Looking above the planet and left of it puts the limb low and right, so the
  // headline sits bottom-left over the horizon rather than over a centred sphere.
  hero: [
    { pos: [0.62, 0.86, 6.0], target: [-1.95, -0.5, 0], fov: 40 },
    { pos: [0.45, 0.7, 5.35], target: [-2.05, -0.58, 0], fov: 39 },
  ],
  hardware: [
    { pos: [2.3, 1.12, 7.3], target: [-0.18, 0.05, 0], fov: 38 },
    { pos: [1.92, 0.94, 6.35], target: [-0.12, 0.02, 0], fov: 37 },
  ],
  missions: [
    { pos: [0.2, 0.72, 8.2], target: [0, -0.2, 0], fov: 42 },
    { pos: [0.1, 0.6, 7.4], target: [0, -0.18, 0], fov: 42 },
  ],
  quiet: [
    { pos: [0, 0.5, 13], target: [0, -1.5, 0], fov: 44 },
    { pos: [0, 0.4, 12], target: [0, -1.6, 0], fov: 44 },
  ],
}

const MOBILE_POSES: Record<ViewKey, [Pose, Pose]> = {
  hero: [
    { pos: [0.34, 1.0, 7.8], target: [-1.2, -0.36, 0], fov: 44 },
    { pos: [0.24, 0.82, 7.15], target: [-1.26, -0.44, 0], fov: 43 },
  ],
  hardware: [
    { pos: [2.5, 1.2, 8.1], target: [0.05, 0.06, 0], fov: 42 },
    { pos: [2.05, 0.96, 7.1], target: [0.05, 0.03, 0], fov: 41 },
  ],
  missions: [
    { pos: [0.2, 0.8, 9.6], target: [0, -1.3, 0], fov: 44 },
    { pos: [0.1, 0.7, 8.8], target: [0, -1.35, 0], fov: 44 },
  ],
  quiet: [
    { pos: [0, 0.5, 15], target: [0, -2.4, 0], fov: 46 },
    { pos: [0, 0.4, 14], target: [0, -2.4, 0], fov: 46 },
  ],
}

const clamp = (v: number): number => Math.min(1, Math.max(0, v))
const smooth = (v: number): number => {
  const t = clamp(v)
  return t * t * (3 - 2 * t)
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const mix = (x: number, y: number): number => x + (y - x) * t
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

export function createScene(
  canvas: HTMLCanvasElement,
  reduced: boolean,
): SceneHandle | null {
  let quality: Quality = detectQuality()
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
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.58
  renderer.setClearColor(new Color(0x191939), 1)
  renderer.setPixelRatio(quality.dpr)
  renderer.setSize(window.innerWidth, window.innerHeight, false)

  const scene = new Scene()
  const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 220)
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  const key = new DirectionalLight(0xf2e199, 2.6)
  key.position.set(4.5, 5.5, 6)
  const rim = new DirectionalLight(0x6fb8e6, 2.2)
  rim.position.set(-5, 1.5, -4.5)
  const fill = new AmbientLight(0x1b3a68, 0.5)
  scene.add(key, rim, fill)

  const sky = new Sky(quality.stars, quality.dpr)
  const globe = new Globe()
  const orbits = new Orbits(quality.reticles, quality.dpr)
  const hardware = new Hardware()
  const overlays = new Overlays()
  const planet = new Group()
  planet.add(globe.group, orbits.group, overlays.group)
  scene.add(sky.object, planet, hardware.group)

  const svg = document.querySelector<SVGSVGElement>('#draft')
  const labelHost = document.querySelector<HTMLElement>('#draft-labels')
  const drafting = svg && labelHost ? new Drafting(svg, labelHost) : null

  let view: ViewKey = 'hero'
  let progress = 0
  let hardwareWeight = 0
  let explode = 0
  let overlayWeight = 0
  let motion = !reduced
  let destroyed = false
  let running = false
  let visible = !document.hidden
  let raf = 0
  let last = performance.now()
  let elapsed = 0
  let smoothing = 0

  let warmup = 0
  let samples = 0
  let sampleTotal = 0
  let measured = false

  const targetPos = new Vector3()
  const targetLook = new Vector3()
  let targetFov = 40

  /* Pointer: a small camera parallax on desktop, and drag-to-spin on the globe. */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  let dragging = false
  let dragX = 0

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    dragging = true
    dragX = event.clientX
    canvas.setPointerCapture?.(event.pointerId)
    document.documentElement.dataset.dragging = 'true'
  }
  function onPointerMove(event: PointerEvent): void {
    const wide = window.innerWidth >= 900
    pointer.tx = wide ? (event.clientX / window.innerWidth) * 2 - 1 : 0
    pointer.ty = wide ? (event.clientY / window.innerHeight) * 2 - 1 : 0
    if (!dragging) return
    const dx = event.clientX - dragX
    dragX = event.clientX
    globe.drag(-dx * 0.0042)
  }
  function onPointerUp(): void {
    dragging = false
    delete document.documentElement.dataset.dragging
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  document.documentElement.dataset.tier = quality.tier

  function applyLayout(): void {
    const mobile = window.innerWidth < 640
    sky.setLayout(mobile)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    drafting?.resize(window.innerWidth, window.innerHeight)
    sky.setPixelRatio(quality.dpr)
    orbits.setPixelRatio(quality.dpr)
  }
  applyLayout()

  function readPose(): void {
    const set = window.innerWidth < 640 ? MOBILE_POSES : POSES
    const pair = set[view]
    const pose = lerpPose(pair[0], pair[1], smooth(progress))
    targetPos.set(pose.pos[0], pose.pos[1], pose.pos[2])
    targetLook.set(pose.target[0], pose.target[1], pose.target[2])
    targetFov = pose.fov
  }

  function applyState(): void {
    const hw = hardwareWeight
    hardware.setOpacity(hw)
    hardware.setExplode(explode)

    planet.position.set(-1.7 * hw, -1.1 * hw, -2.6 * hw)
    planet.scale.setScalar(1 - 0.35 * hw)
    globe.setOpacity((view === 'hardware' ? 0.9 : 1) * (1 - 0.95 * hw))
    orbits.setOpacity((view === 'missions' ? 1 : 0.92) * (1 - 0.96 * hw))
    overlays.setWeight(overlayWeight * (1 - 0.9 * hw))
    sky.setOpacity(1 - 0.12 * hw)
    sky.setParallax(-progress * 0.5, 0)
  }

  function updateCamera(dt: number): void {
    readPose()
    const alpha = motion ? 1 - Math.exp(-dt * 3.6) : 1
    camera.position.lerp(targetPos, alpha)
    // Parallax is applied after the lerp, so it offsets the pose without drifting.
    pointer.x += (pointer.tx - pointer.x) * (motion ? 0.045 : 1)
    pointer.y += (pointer.ty - pointer.y) * (motion ? 0.045 : 1)
    camera.position.x += pointer.x * 0.26
    camera.position.y -= pointer.y * 0.16
    camera.lookAt(targetLook)
    if (Math.abs(camera.fov - targetFov) > 0.001) {
      camera.fov += (targetFov - camera.fov) * alpha
      camera.updateProjectionMatrix()
    }
  }

  function renderFrame(dt: number): void {
    if (destroyed) return
    if (motion) elapsed += dt
    sky.update(elapsed, motion ? 1 : 0)
    globe.update(dt, motion)
    orbits.update(elapsed)
    overlays.update(dt)
    applyState()
    updateCamera(dt)
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld()
    drafting?.setProgress(explode)
    drafting?.update(camera, hardware, window.innerWidth, window.innerHeight)
    renderer.render(scene, camera)
  }

  function start(): void {
    if (running || destroyed) return
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
    const dt = Math.min(0.05, Math.max(0.0005, raw))
    renderFrame(dt)

    smoothing = smoothing === 0 ? raw * 1000 : smoothing * 0.9 + raw * 1000 * 0.1

    if (!measured && motion) {
      if (warmup < 24) {
        warmup += 1
      } else {
        samples += 1
        sampleTotal += raw * 1000
        if (samples >= 60) {
          measured = true
          if (sampleTotal / samples > 24) {
            quality = degradeQuality(quality)
            renderer.setPixelRatio(quality.dpr)
            renderer.setSize(window.innerWidth, window.innerHeight, false)
            sky.setPixelRatio(quality.dpr)
            sky.setCount(quality.stars)
            orbits.setPixelRatio(quality.dpr)
            orbits.setCount(quality.reticles)
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
      if (!motion) renderFrame(0)
    } else {
      stop()
    }
  }

  document.addEventListener('visibilitychange', handleVisibility)
  if (motion) start()
  else renderFrame(0)

  return {
    setView(next: ViewKey, value: number): void {
      view = next
      progress = clamp(value)
      document.documentElement.dataset.view = next
      if (!motion) renderFrame(0)
    },
    setHardware(weight: number, value: number): void {
      hardwareWeight = clamp(weight)
      explode = clamp(value)
      if (!motion) renderFrame(0)
    },
    setOverlay(weight: number): void {
      overlayWeight = clamp(weight)
      if (!motion) renderFrame(0)
    },
    setMode(mode: MissionMode): void {
      overlays.setMode(mode)
      if (!motion) {
        // Static pose: jump the crossfade rather than animating it.
        overlays.update(1)
        renderFrame(0)
      }
    },
    resize(): void {
      applyLayout()
      if (!motion) renderFrame(0)
    },
    stats(): SceneStats {
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        ms: smoothing,
        tier: quality.tier,
      }
    },
    destroy(): void {
      destroyed = true
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      sky.dispose()
      globe.dispose()
      orbits.dispose()
      hardware.dispose()
      overlays.dispose()
      pmrem.dispose()
      renderer.dispose()
    },
  }
}
