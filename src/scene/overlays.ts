import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Quaternion,
  Vector3,
} from 'three'
import { mulberry } from './noise'

export type MissionMode = 'civil' | 'defense'

const RADIUS = 1.56

function fibonacci(index: number, total: number, radius: number): Vector3 {
  const y = 1 - (index / (total - 1)) * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = index * 2.399963229728653
  return new Vector3(Math.cos(theta) * ring, y, Math.sin(theta) * ring).multiplyScalar(radius)
}

function lineGeometry(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(points), 3))
  return geometry
}

export class Overlays {
  readonly group = new Group()
  private readonly civil = new Group()
  private readonly defense = new Group()
  private readonly fades: Array<{ mode: MissionMode; fn: (weight: number) => void }> = []
  private weights = { civil: 1, defense: 0 }
  private targets = { civil: 1, defense: 0 }
  private weight = 0
  private mode: MissionMode = 'civil'
  private readonly nodes: Vector3[] = []

  constructor() {
    this.group.add(this.civil)
    this.group.add(this.defense)
    this.group.visible = false
    const random = mulberry(78331)

    for (let i = 0; i < 96; i += 1) this.nodes.push(fibonacci(i, 96, RADIUS))

    // Civil: a sensing network and the links between its nodes.
    const nodePositions = new Float32Array(this.nodes.length * 3)
    this.nodes.forEach((node, index) => {
      nodePositions[index * 3] = node.x
      nodePositions[index * 3 + 1] = node.y
      nodePositions[index * 3 + 2] = node.z
    })
    const nodeMaterial = new PointsMaterial({
      color: 0x6fb8e6,
      size: 0.02,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.civil.add(new Points(lineGeometry(Array.from(nodePositions)), nodeMaterial))
    this.fades.push({ mode: 'civil', fn: (w) => (nodeMaterial.opacity = 0.6 * w) })

    const arcPoints: number[] = []
    for (let i = 0; i < 24; i += 1) {
      const a = this.nodes[Math.floor(random() * this.nodes.length)]
      let b = this.nodes[Math.floor(random() * this.nodes.length)]
      if (a.distanceTo(b) < 0.7) b = this.nodes[(i * 7) % this.nodes.length]
      const chord = a.distanceTo(b)
      const control = a.clone().add(b).normalize().multiplyScalar(RADIUS + 0.14 + chord * 0.3)
      const sampled = new QuadraticBezierCurve3(a, control, b).getPoints(22)
      for (let s = 0; s < sampled.length - 1; s += 1) {
        arcPoints.push(
          sampled[s].x,
          sampled[s].y,
          sampled[s].z,
          sampled[s + 1].x,
          sampled[s + 1].y,
          sampled[s + 1].z,
        )
      }
    }
    const arcMaterial = new LineBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
    })
    this.civil.add(new LineSegments(lineGeometry(arcPoints), arcMaterial))
    this.fades.push({ mode: 'civil', fn: (w) => (arcMaterial.opacity = 0.17 * w) })

    // Defense: coverage footprints and a denser orbital shell.
    const ringPoints: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const radius = RADIUS + 0.18 + i * 0.12
      const tilt = 0.35 + i * 0.28
      for (let s = 0; s < 120; s += 1) {
        const a = (s / 120) * Math.PI * 2
        const b = ((s + 1) / 120) * Math.PI * 2
        const rotation = new Euler(tilt, i * 0.9, 0.2)
        const point = (angle: number): Vector3 =>
          new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.42, 0).applyEuler(rotation)
        const p0 = point(a)
        const p1 = point(b)
        ringPoints.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
    }
    const ringMaterial = new LineBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    })
    this.defense.add(new LineSegments(lineGeometry(ringPoints), ringMaterial))
    this.fades.push({ mode: 'defense', fn: (w) => (ringMaterial.opacity = 0.26 * w) })

    const footprintMaterial = new MeshBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.14,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const footprints = new InstancedMesh(new CircleGeometry(0.22, 40), footprintMaterial, 7)
    const dummy = new Object3D()
    const normalAxis = new Vector3(0, 0, 1)
    for (let i = 0; i < 7; i += 1) {
      const normal = fibonacci(i * 9 + 11, 96, 1)
      const scale = 0.85 + ((i * 37) % 40) / 100
      dummy.position.copy(normal).multiplyScalar(RADIUS * 1.004)
      dummy.quaternion.copy(
        new Quaternion().setFromUnitVectors(normalAxis, normal.clone().normalize()),
      )
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      footprints.setMatrixAt(i, dummy.matrix as Matrix4)
    }
    footprints.instanceMatrix.needsUpdate = true
    this.defense.add(footprints)
    this.fades.push({ mode: 'defense', fn: (w) => (footprintMaterial.opacity = 0.14 * w) })

    const contact = new Points(
      lineGeometry([0, 0, 0]),
      new PointsMaterial({
        color: 0xecb44d,
        size: 0.075,
        transparent: true,
        opacity: 1,
        sizeAttenuation: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    )
    const contactPoint = fibonacci(41, 96, RADIUS * 1.01)
    const contactGeometry = contact.geometry.getAttribute('position') as Float32BufferAttribute
    contactGeometry.setXYZ(0, contactPoint.x, contactPoint.y, contactPoint.z)
    contactGeometry.needsUpdate = true
    this.defense.add(contact)
    this.fades.push({
      mode: 'defense',
      fn: (w) => {
        ;(contact.material as PointsMaterial).opacity = w
      },
    })

    this.applyWeights()
  }

  setMode(mode: MissionMode): void {
    this.mode = mode
    this.targets = {
      civil: mode === 'civil' ? 1 : 0,
      defense: mode === 'defense' ? 1 : 0,
    }
  }

  setWeight(weight: number): void {
    this.weight = Math.min(1, Math.max(0, weight))
    this.group.visible = this.weight > 0.004
    this.applyWeights()
  }

  update(dt: number): void {
    if (!this.group.visible) return
    // 700ms crossfade, as specified, with no geometry rebuild.
    const step = Math.min(1, dt / 0.7)
    let changed = false
    ;(['civil', 'defense'] as const).forEach((key) => {
      const delta = this.targets[key] - this.weights[key]
      if (Math.abs(delta) > 0.001) {
        this.weights[key] += delta * step
        changed = true
      } else if (this.weights[key] !== this.targets[key]) {
        this.weights[key] = this.targets[key]
        changed = true
      }
    })
    if (changed) this.applyWeights()
  }

  private applyWeights(): void {
    const civilWeight = this.weights.civil * this.weight
    const defenseWeight = this.weights.defense * this.weight
    this.civil.visible = civilWeight > 0.004
    this.defense.visible = defenseWeight > 0.004
    this.fades.forEach(({ mode, fn }) => fn(mode === 'defense' ? defenseWeight : civilWeight))
  }

  get activeMode(): MissionMode {
    return this.mode
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Points || object instanceof LineSegments || object instanceof InstancedMesh) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      }
    })
  }
}
