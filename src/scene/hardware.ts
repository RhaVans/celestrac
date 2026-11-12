import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  RepeatWrapping,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type PartKey = 'arrayL' | 'arrayR' | 'busTop' | 'busBottom' | 'aperture'

/**
 * Drop a real Tycho model here (KTX2 textures). If the file exists it replaces
 * the procedural object; see README for the sourcing note.
 */
export const HARDWARE_GLB = '/models/tycho.glb'

const surface = new Color(0x1b3a68)
const body = new Color(0x6d7f9e)
const data = new Color(0x6fb8e6)
const action = new Color(0xecb44d)

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return [canvas, ctx]
}

/** Solar cell grid: colour, roughness and a matching normal map. */
function solarMaps(): { map: CanvasTexture; roughness: CanvasTexture; normal: CanvasTexture } {
  const size = 256
  const cell = 32
  const [colorCanvas, colorCtx] = makeCanvas(size)
  colorCtx.fillStyle = '#162f52'
  colorCtx.fillRect(0, 0, size, size)
  colorCtx.strokeStyle = 'rgba(111,184,230,0.62)'
  colorCtx.lineWidth = 1.5
  for (let i = 0; i <= size; i += cell) {
    colorCtx.beginPath()
    colorCtx.moveTo(i, 0)
    colorCtx.lineTo(i, size)
    colorCtx.stroke()
    colorCtx.beginPath()
    colorCtx.moveTo(0, i)
    colorCtx.lineTo(size, i)
    colorCtx.stroke()
  }
  colorCtx.fillStyle = 'rgba(111,184,230,0.08)'
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      if ((x / cell + y / cell) % 2 === 0) colorCtx.fillRect(x, y, cell, cell)
    }
  }

  const [roughCanvas, roughCtx] = makeCanvas(size)
  roughCtx.fillStyle = '#5a5a5a'
  roughCtx.fillRect(0, 0, size, size)
  roughCtx.strokeStyle = '#d0d0d0'
  roughCtx.lineWidth = 2
  for (let i = 0; i <= size; i += cell) {
    roughCtx.beginPath()
    roughCtx.moveTo(i, 0)
    roughCtx.lineTo(i, size)
    roughCtx.stroke()
    roughCtx.beginPath()
    roughCtx.moveTo(0, i)
    roughCtx.lineTo(size, i)
    roughCtx.stroke()
  }

  const [normalCanvas, normalCtx] = makeCanvas(size)
  normalCtx.fillStyle = 'rgb(128,128,255)'
  normalCtx.fillRect(0, 0, size, size)
  normalCtx.strokeStyle = 'rgb(170,128,255)'
  normalCtx.lineWidth = 2
  for (let i = 0; i <= size; i += cell) {
    normalCtx.beginPath()
    normalCtx.moveTo(i, 0)
    normalCtx.lineTo(i, size)
    normalCtx.stroke()
    normalCtx.beginPath()
    normalCtx.moveTo(0, i)
    normalCtx.lineTo(size, i)
    normalCtx.stroke()
  }

  const wrap = (canvas: HTMLCanvasElement) => {
    const texture = new CanvasTexture(canvas)
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    texture.repeat.set(3, 3)
    return texture
  }

  return {
    map: wrap(colorCanvas),
    roughness: wrap(roughCanvas),
    normal: wrap(normalCanvas),
  }
}

/** Brushed metal: horizontal streaks for roughness and normal. */
function brushedMaps(): { roughness: CanvasTexture; normal: CanvasTexture } {
  const size = 256
  const [roughCanvas, roughCtx] = makeCanvas(size)
  roughCtx.fillStyle = '#6e6e6e'
  roughCtx.fillRect(0, 0, size, size)
  for (let i = 0; i < 900; i += 1) {
    const y = Math.random() * size
    const alpha = 0.04 + Math.random() * 0.16
    roughCtx.strokeStyle = `rgba(255,255,255,${alpha})`
    roughCtx.lineWidth = Math.random() * 1.4
    roughCtx.beginPath()
    roughCtx.moveTo(0, y)
    roughCtx.lineTo(size, y + (Math.random() - 0.5) * 2)
    roughCtx.stroke()
  }

  const [normalCanvas, normalCtx] = makeCanvas(size)
  normalCtx.fillStyle = 'rgb(128,128,255)'
  normalCtx.fillRect(0, 0, size, size)
  for (let i = 0; i < 420; i += 1) {
    const y = Math.random() * size
    normalCtx.strokeStyle = Math.random() > 0.5 ? 'rgb(138,128,248)' : 'rgb(118,128,248)'
    normalCtx.lineWidth = Math.random() * 2
    normalCtx.beginPath()
    normalCtx.moveTo(0, y)
    normalCtx.lineTo(size, y)
    normalCtx.stroke()
  }

  const wrap = (canvas: HTMLCanvasElement) => {
    const texture = new CanvasTexture(canvas)
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    return texture
  }
  return { roughness: wrap(roughCanvas), normal: wrap(normalCanvas) }
}

interface Part {
  pivot: Group
  base: Vector3
  direction: Vector3
  distance: number
}

export class Hardware {
  readonly group = new Group()
  private readonly parts: Part[] = []
  private readonly materials: MeshPhysicalMaterial[] = []
  private readonly edges: LineBasicMaterial[] = []
  private readonly fades: Array<(value: number) => void> = []
  private readonly anchors = new Map<PartKey, Object3D>()
  private procedural: Group | null = null
  private exploded = 0

  constructor() {
    const root = new Group()
    // Wings span wider than the frame at 1:1; 0.86 keeps both tips in shot.
    root.scale.setScalar(0.86)
    this.group.add(root)
    this.procedural = root

    const solar = solarMaps()
    const brushed = brushedMaps()

    const bodyMaterial = new MeshPhysicalMaterial({
      color: body.clone().multiplyScalar(0.78),
      metalness: 0.72,
      roughness: 0.44,
      roughnessMap: brushed.roughness,
      normalMap: brushed.normal,
      normalScale: new Vector2(0.22, 0.22),
      envMapIntensity: 0.9,
      transparent: true,
    })
    const panelMaterial = new MeshPhysicalMaterial({
      color: 0xffffff,
      map: solar.map,
      roughnessMap: solar.roughness,
      normalMap: solar.normal,
      metalness: 0.42,
      roughness: 0.55,
      envMapIntensity: 0.8,
      clearcoat: 0.24,
      clearcoatRoughness: 0.4,
      transparent: true,
    })
    const darkMaterial = new MeshPhysicalMaterial({
      color: surface.clone().multiplyScalar(0.9),
      metalness: 0.6,
      roughness: 0.32,
      envMapIntensity: 0.75,
      transparent: true,
    })
    const rimMaterial = new MeshPhysicalMaterial({
      color: data.clone().multiplyScalar(0.5),
      metalness: 0.9,
      roughness: 0.26,
      envMapIntensity: 1,
      transparent: true,
    })
    this.materials.push(bodyMaterial, panelMaterial, darkMaterial, rimMaterial)
    this.materials.forEach((material) => this.fades.push((v) => (material.opacity = v)))

    const edgeMaterial = new LineBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    })
    this.edges.push(edgeMaterial)
    this.fades.push((v) => (edgeMaterial.opacity = 0.3 * v))

    const addPart = (
      key: string | null,
      base: Vector3,
      direction: Vector3,
      distance: number,
    ): Group => {
      const pivot = new Group()
      pivot.position.copy(base)
      root.add(pivot)
      if (key) this.parts.push({ pivot, base, direction, distance })
      return pivot
    }

    const addEdges = (mesh: Mesh, geometry: BufferGeometry): void => {
      const line = new LineSegments(new EdgesGeometry(geometry, 26), edgeMaterial)
      line.frustumCulled = false
      line.renderOrder = 2
      mesh.add(line)
    }

    // Bus
    const busPivot = addPart('bus', new Vector3(0, 0, 0), new Vector3(0, -1, 0), 0.14)
    const busGeometry = new RoundedBoxGeometry(1.16, 0.94, 0.94, 4, 0.055)
    const bus = new Mesh(busGeometry, bodyMaterial)
    busPivot.add(bus)
    addEdges(bus, busGeometry)

    // Right face: the bus dimension reads clear of the body instead of across it.
    const topAnchor = new Object3D()
    topAnchor.position.set(0.52, 0.47, 0.18)
    busPivot.add(topAnchor)
    this.anchors.set('busTop', topAnchor)

    const bottomAnchor = new Object3D()
    bottomAnchor.position.set(0.52, -0.47, 0.18)
    busPivot.add(bottomAnchor)
    this.anchors.set('busBottom', bottomAnchor)

    // Radiator on the anti-sun face
    const radiatorGeometry = new RoundedBoxGeometry(0.86, 0.66, 0.05, 2, 0.02)
    const radiator = new Mesh(radiatorGeometry, darkMaterial)
    radiator.position.set(0, 0, -0.49)
    busPivot.add(radiator)
    addEdges(radiator, radiatorGeometry)

    // Star trackers
    for (const x of [-0.32, 0.32]) {
      const tracker = new Mesh(new CylinderGeometry(0.07, 0.08, 0.12, 20), darkMaterial)
      tracker.position.set(x, 0.51, 0.22)
      busPivot.add(tracker)
    }

    // Serial plate: real text baked into a texture, not modelled glyphs.
    const plateCanvas = document.createElement('canvas')
    plateCanvas.width = 512
    plateCanvas.height = 232
    const plateCtx = plateCanvas.getContext('2d')
    if (plateCtx) {
      plateCtx.fillStyle = '#93a1b6'
      plateCtx.fillRect(0, 0, 512, 232)
      plateCtx.fillStyle = '#26314a'
      plateCtx.font = '600 44px monospace'
      plateCtx.fillText('TYCHO-2', 26, 70)
      plateCtx.font = '500 30px monospace'
      plateCtx.fillText('SN 0417 · 2026', 26, 122)
      plateCtx.font = '400 26px monospace'
      plateCtx.fillText('F/2.4 · 600 KM SSO', 26, 168)
      plateCtx.strokeStyle = 'rgba(38,49,74,0.45)'
      plateCtx.lineWidth = 4
      plateCtx.strokeRect(8, 8, 496, 216)
    }
    const plateTexture = new CanvasTexture(plateCanvas)
    plateTexture.colorSpace = SRGBColorSpace
    const plateMaterial = new MeshPhysicalMaterial({
      map: plateTexture,
      metalness: 0.68,
      roughness: 0.46,
      transparent: true,
    })
    this.materials.push(plateMaterial)
    this.fades.push((value) => (plateMaterial.opacity = value))
    const plate = new Mesh(new PlaneGeometry(0.36, 0.16), plateMaterial)
    plate.position.set(0.17, 0.2, 0.474)
    busPivot.add(plate)

    // Thermal blanket: crinkled foil over the +Y face, a different roughness.
    const blanketCanvas = document.createElement('canvas')
    blanketCanvas.width = 256
    blanketCanvas.height = 256
    const blanketCtx = blanketCanvas.getContext('2d')
    if (blanketCtx) {
      blanketCtx.fillStyle = '#b9c2d2'
      blanketCtx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 220; i += 1) {
        const x = Math.random() * 256
        const y = Math.random() * 256
        const len = 8 + Math.random() * 42
        blanketCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(52,66,94,0.45)'
        blanketCtx.lineWidth = 0.6 + Math.random() * 1.2
        blanketCtx.beginPath()
        blanketCtx.moveTo(x, y)
        blanketCtx.lineTo(x + len * 0.7, y + (Math.random() - 0.5) * len)
        blanketCtx.stroke()
      }
    }
    const blanketTexture = new CanvasTexture(blanketCanvas)
    blanketTexture.colorSpace = SRGBColorSpace
    blanketTexture.wrapS = RepeatWrapping
    blanketTexture.wrapT = RepeatWrapping
    blanketTexture.repeat.set(2, 2)
    const blanketMaterial = new MeshPhysicalMaterial({
      map: blanketTexture,
      metalness: 0.15,
      roughness: 0.82,
      transparent: true,
    })
    this.materials.push(blanketMaterial)
    this.fades.push((value) => (blanketMaterial.opacity = value))
    const blanket = new Mesh(new PlaneGeometry(0.62, 0.42), blanketMaterial)
    blanket.rotation.x = -Math.PI / 2
    blanket.position.set(-0.16, 0.472, -0.06)
    busPivot.add(blanket)

    // Fasteners: one per corner of the front face, plus the blanket's edge.
    for (const [x, y] of [
      [-0.5, 0.4],
      [0.5, 0.4],
      [-0.5, -0.4],
      [0.5, -0.4],
      [-0.46, 0.46],
      [0.46, 0.46],
    ]) {
      const bolt = new Mesh(new CylinderGeometry(0.016, 0.016, 0.014, 8), rimMaterial)
      bolt.rotation.x = Math.PI / 2
      bolt.position.set(x, y, 0.474)
      busPivot.add(bolt)
    }

    // Optical payload
    const payloadPivot = addPart('payload', new Vector3(0, 0.02, 0.46), new Vector3(0, 0, 1), 0.4)
    const barrelGeometry = new CylinderGeometry(0.27, 0.3, 0.62, 40)
    const barrel = new Mesh(barrelGeometry, bodyMaterial)
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = 0.3
    payloadPivot.add(barrel)
    addEdges(barrel, barrelGeometry)

    const hoodGeometry = new CylinderGeometry(0.33, 0.3, 0.1, 40)
    const hood = new Mesh(hoodGeometry, rimMaterial)
    hood.rotation.x = Math.PI / 2
    hood.position.z = 0.64
    payloadPivot.add(hood)

    const baffle = new Mesh(
      new CylinderGeometry(0.3, 0.3, 0.02, 40, 1, true),
      new MeshBasicMaterial({ color: 0x0b1020, side: DoubleSide }),
    )
    baffle.rotation.x = Math.PI / 2
    baffle.position.z = 0.69
    payloadPivot.add(baffle)

    const apertureMaterial = new MeshBasicMaterial({
      color: 0x0d1a2e,
      transparent: true,
      opacity: 0.92,
      side: DoubleSide,
      depthWrite: false,
    })
    this.fades.push((value) => (apertureMaterial.opacity = 0.92 * value))
    const aperture = new Mesh(new CircleGeometry(0.168, 48), apertureMaterial)
    aperture.position.z = 0.695
    payloadPivot.add(aperture)

    // A thin warm ring instead of a solid disc: one small action mark, not a sticker.
    const ringMaterial = new MeshBasicMaterial({
      color: action,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    this.fades.push((value) => (ringMaterial.opacity = 0.55 * value))
    const ring = new Mesh(new RingGeometry(0.186, 0.196, 48), ringMaterial)
    ring.position.z = 0.696
    payloadPivot.add(ring)

    const apertureAnchor = new Object3D()
    apertureAnchor.position.set(0, 0.19, 0.7)
    payloadPivot.add(apertureAnchor)
    this.anchors.set('aperture', apertureAnchor)

    // Solar arrays: three panelled wings on each side.
    const addWing = (sign: 1 | -1): void => {
      const wingPivot = addPart(
        'array',
        new Vector3(sign * 0.6, 0, 0),
        new Vector3(sign, 0, 0),
        0.46,
      )
      const boom = new Mesh(new CylinderGeometry(0.035, 0.035, 0.5, 14), rimMaterial)
      boom.rotation.z = Math.PI / 2
      boom.position.x = sign * 0.22
      wingPivot.add(boom)

      const panelGeometry = new RoundedBoxGeometry(0.92, 0.045, 0.72, 2, 0.016)
      for (let i = 0; i < 3; i += 1) {
        const panel = new Mesh(panelGeometry, panelMaterial)
        panel.position.x = sign * (0.86 + i * 0.95)
        wingPivot.add(panel)
        addEdges(panel, panelGeometry)
      }

      const anchor = new Object3D()
      anchor.position.set(sign * 2.4, 0.06, 0.36)
      wingPivot.add(anchor)
      this.anchors.set(sign === 1 ? 'arrayR' : 'arrayL', anchor)
    }
    addWing(-1)
    addWing(1)

    // Crosslink antenna
    const antennaPivot = addPart('antenna', new Vector3(0, 0.5, -0.18), new Vector3(0, 1, 0), 0.16)
    // Long enough that the boom still reaches the bus when the dish lifts away.
    const stalk = new Mesh(new CylinderGeometry(0.03, 0.038, 0.5, 14), rimMaterial)
    stalk.position.y = 0.25
    antennaPivot.add(stalk)

    const dishGeometry = new SphereGeometry(0.3, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2.6)
    const dish = new Mesh(dishGeometry, bodyMaterial)
    dish.position.y = 0.58
    antennaPivot.add(dish)
    addEdges(dish, dishGeometry)

    const feed = new Mesh(new CylinderGeometry(0.014, 0.014, 0.22, 10), rimMaterial)
    feed.position.y = 0.7
    antennaPivot.add(feed)

    // Thrusters
    for (const [x, z] of [
      [-0.44, 0.44],
      [0.44, 0.44],
      [-0.44, -0.44],
      [0.44, -0.44],
    ]) {
      const thruster = new Mesh(new CylinderGeometry(0.045, 0.06, 0.1, 14), darkMaterial)
      thruster.position.set(x, -0.5, z)
      busPivot.add(thruster)
    }

    this.setOpacity(0)
    void this.tryLoadGlb()
  }

  /** Loads a real GLB if one is present, otherwise keeps the procedural object. */
  private async tryLoadGlb(): Promise<void> {
    try {
      const head = await fetch(HARDWARE_GLB, { method: 'HEAD' })
      if (!head.ok) return
      const gltf = await new GLTFLoader().loadAsync(HARDWARE_GLB)
      if (!this.procedural) return
      this.procedural.visible = false
      const model = gltf.scene
      this.group.add(model)
      this.applyModelAnchors(model)
      this.setExplode(this.exploded)
    } catch {
      // No model shipped; the procedural object is the shipped state.
    }
  }

  /** Anchors for the drafting overlay, taken from the loaded model's bounds. */
  private applyModelAnchors(model: Group): void {
    const box = new Box3().setFromObject(model)
    const mid = box.getCenter(new Vector3())
    const set = (key: PartKey, point: Vector3): void => {
      const anchor = new Object3D()
      anchor.position.copy(point)
      this.group.add(anchor)
      this.anchors.set(key, anchor)
    }
    set('arrayL', new Vector3(box.min.x, mid.y, mid.z))
    set('arrayR', new Vector3(box.max.x, mid.y, mid.z))
    set('busTop', new Vector3(mid.x, box.max.y, mid.z))
    set('busBottom', new Vector3(mid.x, box.min.y, mid.z))
    set('aperture', new Vector3(mid.x, box.max.y, box.max.z))
  }

  setExplode(progress: number): void {
    this.exploded = Math.min(1, Math.max(0, progress))
    this.parts.forEach((part) => {
      part.pivot.position.copy(part.base).addScaledVector(part.direction, part.distance * this.exploded)
    })
    this.group.updateMatrixWorld(true)
  }

  setOpacity(value: number): void {
    const v = Math.min(1, Math.max(0, value))
    this.group.visible = v > 0.01
    this.fades.forEach((fade) => fade(v))
  }

  getAnchor(key: PartKey, target: Vector3): Vector3 {
    const anchor = this.anchors.get(key)
    if (!anchor) return target.set(0, 0, 0)
    return anchor.getWorldPosition(target)
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      }
    })
  }
}
