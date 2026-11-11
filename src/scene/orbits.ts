import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
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
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import { mulberry } from './noise'

const GLOBE_RADIUS = 1.55

interface OrbitConfig {
  rx: number
  ry: number
  tilt: number
  node: number
  matrix: Matrix4
}

interface Satellite {
  orbit: number
  phase: number
  speed: number
  color: Color
  size: number
}

const SAT_VERTEX = /* glsl */ `
  uniform float uDpr;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uDpr * (18.0 / max(0.1, -mv.z));
    vColor = aColor;
  }
`

const SAT_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float alpha = smoothstep(1.0, 0.18, d) * uOpacity;
    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
  }
`

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
    float edge = smoothstep(1.0, 0.9, d) * smoothstep(0.74, 1.0, d);
    float fill = smoothstep(1.0, 0.1, d) * 0.14;
    gl_FragColor = vec4(uColor, (edge * 0.62 + fill) * uOpacity);
    #include <colorspace_fragment>
  }
`

function reticleTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    const inset = 10
    const arm = 10
    const corner = (x: number, y: number, dx: number, dy: number) => {
      ctx.beginPath()
      ctx.moveTo(x + dx * arm, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y + dy * arm)
      ctx.stroke()
    }
    corner(inset, inset, 1, 1)
    corner(64 - inset, inset, -1, 1)
    corner(inset, 64 - inset, 1, -1)
    corner(64 - inset, 64 - inset, -1, -1)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(31, 31, 2, 2)
  }
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export class Orbits {
  readonly group = new Group()
  private readonly configs: OrbitConfig[] = []
  private readonly lines: Line[] = []
  private readonly satellites: Satellite[] = []
  private readonly satPoints: Points
  private readonly satGeometry: BufferGeometry
  private readonly satMaterial: ShaderMaterial
  private readonly reticles: Sprite[] = []
  private readonly reticleTexture: CanvasTexture
  private readonly highlight: number
  private readonly groundTrack: Line
  private readonly groundPositions: Float32Array
  private readonly footprint: { mesh: Mesh; material: ShaderMaterial }
  private readonly baseOpacities: number[] = []
  private highlightPhase = 0
  private groupOpacity = 1
  private loopValue: number | null = null
  private footprintStrength = 1

  constructor(orbitCount: number, satelliteCount: number, reticleCount: number, dpr: number) {
    this.highlight = Math.min(2, orbitCount - 1)
    const random = mulberry(4711)

    for (let i = 0; i < orbitCount; i += 1) {
      const rx = 2.0 + random() * 1.35
      const ry = 1.85 + random() * 1.2
      const tilt = (random() - 0.5) * 1.5
      const node = random() * Math.PI * 2
      const matrix = new Matrix4().makeRotationFromEuler(new Euler(tilt, node, 0, 'XYZ'))
      this.configs.push({ rx, ry, tilt, node, matrix })
    }

    for (let i = 0; i < orbitCount; i += 1) {
      const config = this.configs[i]
      const isHighlight = i === this.highlight
      const values: number[] = []
      const steps = 192
      for (let s = 0; s <= steps; s += 1) {
        const u = (s / steps) * Math.PI * 2
        const point = new Vector3(
          Math.cos(u) * config.rx,
          Math.sin(u) * config.ry,
          0,
        ).applyMatrix4(config.matrix)
        values.push(point.x, point.y, point.z)
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(values), 3))
      const material = new LineBasicMaterial({
        color: isHighlight ? 0xecb44d : 0x6fb8e6,
        transparent: true,
        opacity: isHighlight ? 0.66 : 0.17 + i * 0.012,
        depthWrite: false,
      })
      const line = new Line(geometry, material)
      line.frustumCulled = false
      this.baseOpacities.push(material.opacity)
      this.lines.push(line)
      this.group.add(line)
    }

    const positions = new Float32Array(satelliteCount * 3)
    const colors = new Float32Array(satelliteCount * 3)
    const sizes = new Float32Array(satelliteCount)
    const data = new Color(0x6fb8e6)
    const action = new Color(0xecb44d)

    for (let i = 0; i < satelliteCount; i += 1) {
      const orbit = i === 0 ? this.highlight : Math.floor(random() * orbitCount)
      const color = orbit === this.highlight ? action : data
      this.satellites.push({
        orbit,
        phase: i === 0 ? 0.6 : random() * Math.PI * 2,
        speed: 0.055 + random() * 0.075,
        color,
        size: orbit === this.highlight ? 3.1 : 2.1,
      })
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
      sizes[i] = this.satellites[i].size
    }

    this.satGeometry = new BufferGeometry()
    this.satGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    this.satGeometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3))
    this.satGeometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
    this.satMaterial = new ShaderMaterial({
      vertexShader: SAT_VERTEX,
      fragmentShader: SAT_FRAGMENT,
      uniforms: { uDpr: { value: dpr }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.satPoints = new Points(this.satGeometry, this.satMaterial)
    this.satPoints.frustumCulled = false
    this.group.add(this.satPoints)

    this.reticleTexture = reticleTexture()
    for (let i = 0; i < reticleCount; i += 1) {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: this.reticleTexture,
          color: 0x6fb8e6,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      )
      sprite.scale.setScalar(0.17)
      sprite.renderOrder = 2
      this.reticles.push(sprite)
      this.group.add(sprite)
    }

    this.groundPositions = new Float32Array(72 * 3)
    const trackGeometry = new BufferGeometry()
    trackGeometry.setAttribute('position', new Float32BufferAttribute(this.groundPositions, 3))
    this.groundTrack = new Line(
      trackGeometry,
      new LineBasicMaterial({
        color: 0xecb44d,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
    )
    this.groundTrack.frustumCulled = false
    this.group.add(this.groundTrack)

    const footprintMaterial = new ShaderMaterial({
      vertexShader: FOOTPRINT_VERTEX,
      fragmentShader: FOOTPRINT_FRAGMENT,
      uniforms: {
        uColor: { value: action.clone() },
        uOpacity: { value: 0.75 },
      },
      transparent: true,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    const footprint = new Mesh(new CircleGeometry(0.26, 48), footprintMaterial)
    footprint.frustumCulled = false
    this.footprint = { mesh: footprint, material: footprintMaterial }
    this.group.add(footprint)

    this.update(0)
  }

  setPixelRatio(dpr: number): void {
    this.satMaterial.uniforms.uDpr.value = dpr
  }

  setCount(orbitLimit: number, satelliteLimit: number, reticleLimit: number): void {
    this.lines.forEach((line, index) => {
      line.visible = index < orbitLimit
    })
    this.satGeometry.setDrawRange(0, Math.min(satelliteLimit, this.satellites.length))
    this.reticles.forEach((sprite, index) => {
      sprite.visible = index < reticleLimit
    })
  }

  setLoopProgress(value: number | null): void {
    this.loopValue = value
    this.updateLineOpacities()
  }

  setOpacity(value: number): void {
    this.groupOpacity = Math.min(1, Math.max(0, value))
    this.updateLineOpacities()
    this.satMaterial.uniforms.uOpacity.value = this.groupOpacity
    this.reticles.forEach((sprite) => {
      ;(sprite.material as SpriteMaterial).opacity = 0.5 * this.groupOpacity
    })
    ;(this.groundTrack.material as LineBasicMaterial).opacity = 0.48 * this.groupOpacity
    this.footprint.material.uniforms.uOpacity.value =
      (0.45 + this.footprintStrength * 0.55) * this.groupOpacity
  }

  private updateLineOpacities(): void {
    this.lines.forEach((line, index) => {
      const material = line.material as LineBasicMaterial
      if (index === this.highlight || this.loopValue === null) {
        material.opacity = this.baseOpacities[index] * this.groupOpacity
        return
      }
      const lit = index < 4 && index <= Math.floor(this.loopValue * 4)
      const base = lit
        ? Math.min(0.7, this.baseOpacities[index] + 0.42)
        : this.baseOpacities[index]
      material.opacity = base * this.groupOpacity
    })
  }

  update(time: number): void {
    const positions = this.satGeometry.getAttribute('position') as Float32BufferAttribute

    this.satellites.forEach((satellite, index) => {
      const u = satellite.phase + time * satellite.speed
      const point = this.pointAt(satellite.orbit, u)
      positions.setXYZ(index, point.x, point.y, point.z)
      if (index === 0) {
        this.highlightPhase = u
        this.updateGroundTrack(u)
      }
    })
    positions.needsUpdate = true

    const step = Math.max(1, Math.floor(this.satellites.length / Math.max(1, this.reticles.length)))
    this.reticles.forEach((sprite, index) => {
      const satellite = this.satellites[index * step]
      if (!satellite) return
      const u = satellite.phase + time * satellite.speed
      const point = this.pointAt(satellite.orbit, u)
      sprite.position.copy(point)
    })
  }

  private pointAt(orbitIndex: number, u: number): Vector3 {
    const config = this.configs[orbitIndex] ?? this.configs[0]
    return new Vector3(
      Math.cos(u) * config.rx,
      Math.sin(u) * config.ry,
      0,
    ).applyMatrix4(config.matrix)
  }

  private updateGroundTrack(u: number): void {
    const config = this.configs[this.highlight]
    const positions = this.groundTrack.geometry.getAttribute('position') as Float32BufferAttribute
    const count = positions.count
    for (let i = 0; i < count; i += 1) {
      const sample = u - 0.85 + (i / (count - 1)) * 1.7
      const point = new Vector3(
        Math.cos(sample) * config.rx,
        Math.sin(sample) * config.ry,
        0,
      )
        .applyMatrix4(config.matrix)
        .normalize()
        .multiplyScalar(GLOBE_RADIUS * 1.012)
      positions.setXYZ(i, point.x, point.y, point.z)
    }
    positions.needsUpdate = true

    const contact = this.pointAt(this.highlight, this.highlightPhase)
      .normalize()
      .multiplyScalar(GLOBE_RADIUS * 1.014)
    this.footprint.mesh.position.copy(contact)
    this.footprint.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), contact.clone().normalize())
  }

  setFootprintStrength(value: number): void {
    this.footprintStrength = value
    this.footprint.material.uniforms.uOpacity.value =
      (0.45 + value * 0.55) * this.groupOpacity
  }

  dispose(): void {
    this.lines.forEach((line) => {
      line.geometry.dispose()
      ;(line.material as LineBasicMaterial).dispose()
    })
    this.satGeometry.dispose()
    this.satMaterial.dispose()
    this.reticleTexture.dispose()
    this.groundTrack.geometry.dispose()
    ;(this.groundTrack.material as LineBasicMaterial).dispose()
    this.footprint.mesh.geometry.dispose()
    this.footprint.material.dispose()
  }
}

