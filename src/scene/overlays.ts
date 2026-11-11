import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  ShaderMaterial,
  Vector3,
} from 'three'
import gsap from 'gsap'
import { mulberry } from './noise'

export type MissionMode = 'civil' | 'defense'

interface Fade {
  (weight: number): void
}

interface MovingTrack {
  points: Vector3[]
  offset: number
  speed: number
}

const FOOTPRINT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FOOTPRINT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;
    float ring = smoothstep(1.0, 0.92, d) * smoothstep(0.78, 0.98, d);
    float fill = smoothstep(1.0, 0.15, d) * 0.12;
    gl_FragColor = vec4(uColor, (ring * 0.5 + fill) * uOpacity);
    #include <colorspace_fragment>
  }
`

function fibonacci(index: number, total: number, radius: number): Vector3 {
  const y = 1 - (index / (total - 1)) * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = index * 2.399963229728653
  return new Vector3(Math.cos(theta) * ring, y, Math.sin(theta) * ring).multiplyScalar(radius)
}

export class Overlays {
  readonly group = new Group()
  private readonly civil = new Group()
  private readonly defense = new Group()
  private readonly civilFades: Fade[] = []
  private readonly defenseFades: Fade[] = []
  private readonly weights = { civil: 1, defense: 0 }
  private readonly civilTracks: MovingTrack[] = []
  private readonly defenseTracks: MovingTrack[] = []
  private readonly civilSatGeometry: BufferGeometry
  private readonly defenseSatGeometry: BufferGeometry
  private readonly civilSats: Vector3[]
  private readonly defenseSats: Vector3[]
  private readonly contactGeometry: BufferGeometry
  private chapterWeight = 0
  private mode: MissionMode = 'civil'

  constructor() {
    const random = mulberry(78331)
    const data = new Color(0x6fb8e6)
    const action = new Color(0xecb44d)
    const radius = 1.58

    this.group.add(this.civil)
    this.group.add(this.defense)
    this.defense.visible = false
    this.civil.visible = false
    this.group.visible = false

    const nodes: Vector3[] = []
    for (let i = 0; i < 118; i += 1) {
      nodes.push(fibonacci(i, 118, radius))
    }

    const nodePositions = new Float32Array(nodes.length * 3)
    nodes.forEach((node, index) => {
      nodePositions[index * 3] = node.x
      nodePositions[index * 3 + 1] = node.y
      nodePositions[index * 3 + 2] = node.z
    })
    const nodeGeometry = new BufferGeometry()
    nodeGeometry.setAttribute('position', new Float32BufferAttribute(nodePositions, 3))
    const nodeMaterial = new PointsMaterial({
      color: 0x6fb8e6,
      size: 0.022,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.civil.add(new Points(nodeGeometry, nodeMaterial))
    this.civilFades.push((weight) => {
      nodeMaterial.opacity = 0.55 * weight
    })

    for (let i = 0; i < 30; i += 1) {
      const a = nodes[Math.floor(random() * nodes.length)]
      let b = nodes[Math.floor(random() * nodes.length)]
      if (a.distanceTo(b) < 0.6) b = nodes[Math.floor(random() * nodes.length)]
      const chord = a.distanceTo(b)
      const control = a.clone().add(b).normalize().multiplyScalar(radius + 0.16 + chord * 0.34)
      const curve = new QuadraticBezierCurve3(a, control, b)
      const geometry = new BufferGeometry().setFromPoints(curve.getPoints(30))
      const material = new LineBasicMaterial({
        color: 0x6fb8e6,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      })
      this.civil.add(new Line(geometry, material))
      this.civilFades.push((weight) => {
        material.opacity = 0.16 * weight
      })
    }

    // Sparse, slow low tracks for the civil network.
    for (let i = 0; i < 14; i += 1) {
      const rx = 1.75 + random() * 0.4
      const ry = rx * (0.72 + random() * 0.3)
      const tilt = (random() - 0.5) * 2.4
      const node = random() * Math.PI * 2
      const matrix = new Matrix4().makeRotationFromEuler(new Euler(tilt, node, 0, 'XYZ'))
      const points: Vector3[] = []
      const arc = 1.3 + random() * 1.1
      const start = random() * Math.PI * 2
      const steps = 40
      for (let s = 0; s <= steps; s += 1) {
        const u = start + (s / steps) * arc
        points.push(new Vector3(Math.cos(u) * rx, Math.sin(u) * ry, 0).applyMatrix4(matrix))
      }
      const geometry = new BufferGeometry().setFromPoints(points)
      const material = new LineBasicMaterial({
        color: 0x6fb8e6,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      })
      this.civil.add(new Line(geometry, material))
      this.civilFades.push((weight) => {
        material.opacity = 0.14 * weight
      })
      this.civilTracks.push({ points, offset: random(), speed: 0.006 + random() * 0.008 })
    }

    this.civilSats = this.civilTracks.map(() => new Vector3())
    const civilSatPositions = new Float32Array(this.civilTracks.length * 3)
    this.civilSatGeometry = new BufferGeometry()
    this.civilSatGeometry.setAttribute('position', new Float32BufferAttribute(civilSatPositions, 3))
    const civilSatMaterial = new PointsMaterial({
      color: 0x6fb8e6,
      size: 0.034,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
    })
    this.civil.add(new Points(this.civilSatGeometry, civilSatMaterial))
    this.civilFades.push((weight) => {
      civilSatMaterial.opacity = 0.9 * weight
    })

    // Defense: orbital tracks dominate and coverage footprints overlap.
    for (let i = 0; i < 7; i += 1) {
      const rx = 2.15 + i * 0.2 + random() * 0.35
      const ry = rx * (0.7 + random() * 0.28)
      const tilt = (random() - 0.5) * 2.2
      const node = random() * Math.PI * 2
      const matrix = new Matrix4().makeRotationFromEuler(new Euler(tilt, node, 0, 'XYZ'))
      const points: Vector3[] = []
      for (let s = 0; s <= 160; s += 1) {
        const u = (s / 160) * Math.PI * 2
        points.push(new Vector3(Math.cos(u) * rx, Math.sin(u) * ry, 0).applyMatrix4(matrix))
      }
      const geometry = new BufferGeometry().setFromPoints(points)
      const material = new LineBasicMaterial({
        color: 0x6fb8e6,
        transparent: true,
        opacity: 0.27,
        depthWrite: false,
      })
      this.defense.add(new Line(geometry, material))
      this.defenseFades.push((weight) => {
        material.opacity = 0.27 * weight
      })
      this.defenseTracks.push({ points, offset: random(), speed: 0.01 + random() * 0.01 })
    }

    this.defenseSats = this.defenseTracks.map(() => new Vector3())
    const satsPerTrack = 2
    const defenseSatCount = this.defenseTracks.length * satsPerTrack
    const defenseSatPositions = new Float32Array(defenseSatCount * 3)
    this.defenseSatGeometry = new BufferGeometry()
    this.defenseSatGeometry.setAttribute('position', new Float32BufferAttribute(defenseSatPositions, 3))
    const defenseSatMaterial = new PointsMaterial({
      color: 0x6fb8e6,
      size: 0.035,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.defense.add(new Points(this.defenseSatGeometry, defenseSatMaterial))
    this.defenseFades.push((weight) => {
      defenseSatMaterial.opacity = 0.95 * weight
    })

    const footprintMaterial = new ShaderMaterial({
      vertexShader: FOOTPRINT_VERTEX,
      fragmentShader: FOOTPRINT_FRAGMENT,
      uniforms: {
        uColor: { value: data.clone() },
        uOpacity: { value: 0.16 },
      },
      transparent: true,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    const highlightMaterial = footprintMaterial.clone()
    highlightMaterial.uniforms = {
      uColor: { value: action.clone() },
      uOpacity: { value: 0.34 },
    }

    for (let i = 0; i < 9; i += 1) {
      const normal = fibonacci(i + 22, 61, 1)
      const size = 0.24 + random() * 0.18
      const isContact = i === 3
      const mesh = new Mesh(new CircleGeometry(size, 40), isContact ? highlightMaterial : footprintMaterial)
      mesh.position.copy(normal).multiplyScalar(1.594)
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal)
      this.defense.add(mesh)
    }
    this.defenseFades.push((weight) => {
      footprintMaterial.uniforms.uOpacity.value = 0.16 * weight
      highlightMaterial.uniforms.uOpacity.value = 0.34 * weight
    })

    const contactPosition = fibonacci(25, 61, 1).multiplyScalar(1.6)
    this.contactGeometry = new BufferGeometry()
    this.contactGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        new Float32Array([contactPosition.x, contactPosition.y, contactPosition.z]),
        3,
      ),
    )
    const contactMaterial = new PointsMaterial({
      color: 0xecb44d,
      size: 0.075,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.defense.add(new Points(this.contactGeometry, contactMaterial))
    this.defenseFades.push((weight) => {
      contactMaterial.opacity = weight
    })

    this.applyWeights()
  }

  setMode(mode: MissionMode, immediate = false): void {
    if (mode === this.mode) return
    this.mode = mode
    if (immediate) {
      this.weights.civil = mode === 'civil' ? 1 : 0
      this.weights.defense = mode === 'defense' ? 1 : 0
      this.applyWeights()
      return
    }
    gsap.to(this.weights, {
      civil: mode === 'civil' ? 1 : 0,
      defense: mode === 'defense' ? 1 : 0,
      duration: 0.7,
      ease: 'power2.inOut',
      overwrite: true,
      onUpdate: () => this.applyWeights(),
    })
  }

  setChapterWeight(weight: number): void {
    this.chapterWeight = Math.min(1, Math.max(0, weight))
    this.group.visible = this.chapterWeight > 0.002
    this.applyWeights()
  }

  update(time: number): void {
    if (!this.group.visible) return

    this.civilTracks.forEach((track, index) => {
      const point = this.sampleTrack(track.points, track.offset + time * track.speed)
      this.civilSats[index]?.copy(point)
      this.civilSatGeometry.getAttribute('position').setXYZ(index, point.x, point.y, point.z)
    })
    this.civilSatGeometry.getAttribute('position').needsUpdate = true

    this.defenseTracks.forEach((track, index) => {
      const first = this.sampleTrack(track.points, track.offset + time * track.speed)
      const second = this.sampleTrack(track.points, track.offset + time * track.speed + 0.5)
      this.defenseSats[index * 2]?.copy(first)
      this.defenseSats[index * 2 + 1]?.copy(second)
      const positions = this.defenseSatGeometry.getAttribute('position')
      positions.setXYZ(index * 2, first.x, first.y, first.z)
      positions.setXYZ(index * 2 + 1, second.x, second.y, second.z)
    })
    this.defenseSatGeometry.getAttribute('position').needsUpdate = true
  }

  trackCount(): number {
    return this.mode === 'civil' ? 142 : 78
  }

  private sampleTrack(points: Vector3[], position: number): Vector3 {
    if (points.length === 0) return new Vector3()
    const wrapped = ((position % 1) + 1) % 1
    const exact = wrapped * (points.length - 1)
    const index = Math.floor(exact)
    const next = Math.min(points.length - 1, index + 1)
    return points[index].clone().lerp(points[next], exact - index)
  }

  private applyWeights(): void {
    const civilWeight = this.weights.civil * this.chapterWeight
    const defenseWeight = this.weights.defense * this.chapterWeight
    this.civil.visible = civilWeight > 0.002
    this.defense.visible = defenseWeight > 0.002
    this.civilFades.forEach((fade) => fade(civilWeight))
    this.defenseFades.forEach((fade) => fade(defenseWeight))
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line || object instanceof Points) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      }
    })
  }
}
