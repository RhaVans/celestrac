import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import { mulberry } from './noise'

const MU = 398_600.4418 // km^3/s^2
const EARTH_RADIUS_KM = 6_371
const SCENE_RADIUS = 1.55
const DISPLAY_TIME = 140 // scene seconds per real second

interface Family {
  id: string
  altitude: number
  inclination: number
  count: number
  lineOpacity: number
}

/* Real families: sun-synchronous LEO, ISS-like LEO, GNSS-like MEO, GEO. */
const FAMILIES: Family[] = [
  { id: 'sso', altitude: 600, inclination: 98, count: 6, lineOpacity: 0.3 },
  { id: 'leo', altitude: 420, inclination: 51.6, count: 4, lineOpacity: 0.22 },
  { id: 'meo', altitude: 20_200, inclination: 55, count: 5, lineOpacity: 0.18 },
  { id: 'geo', altitude: 35_786, inclination: 0.4, count: 3, lineOpacity: 0.3 },
]

/*
 * shortcut: altitude is compressed logarithmically so GEO and LEO share one
 * frame. Keplerian periods, inclinations and ground tracks stay real; the
 * radial distances are display-only.
 */
function displayRadius(altitudeKm: number): number {
  return SCENE_RADIUS * (1 + 0.55 * Math.log10(1 + altitudeKm / 250))
}

function orbitalPosition(
  radius: number,
  inclinationDeg: number,
  raan: number,
  anomaly: number,
  out: Vector3,
): Vector3 {
  const inc = (inclinationDeg * Math.PI) / 180
  const x = Math.cos(anomaly) * radius
  const y = Math.sin(anomaly) * radius
  const yi = y * Math.cos(inc)
  const zi = y * Math.sin(inc)
  out.set(x * Math.cos(raan) + zi * Math.sin(raan), yi, -x * Math.sin(raan) + zi * Math.cos(raan))
  return out
}

const SAT_VERTEX = /* glsl */ `
  uniform float uDpr;
  uniform float uOpacity;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uDpr * (16.0 / max(0.1, -mv.z));
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
    gl_FragColor = vec4(vColor, smoothstep(1.0, 0.15, d) * uOpacity);
    #include <colorspace_fragment>
  }
`

function reticleTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    const inset = 7
    const arm = 7
    const corner = (x: number, y: number, dx: number, dy: number) => {
      ctx.beginPath()
      ctx.moveTo(x + dx * arm, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y + dy * arm)
      ctx.stroke()
    }
    corner(inset, inset, 1, 1)
    corner(48 - inset, inset, -1, 1)
    corner(inset, 48 - inset, 1, -1)
    corner(48 - inset, 48 - inset, -1, -1)
  }
  const texture = new CanvasTexture(canvas)
  return texture
}

interface Satellite {
  family: Family
  radius: number
  raan: number
  phase: number
  rate: number
}

export class Orbits {
  readonly group = new Group()
  private readonly satellites: Satellite[] = []
  private readonly satGeometry = new BufferGeometry()
  private readonly satMaterial: ShaderMaterial
  private readonly satPositions: Float32Array
  private readonly reticles: Sprite[] = []
  private readonly fallbackReticleTexture = reticleTexture()
  private readonly groundTrack: Line
  private readonly footprint: Mesh
  private readonly highlightRadius: number
  private readonly highlightInclination: number
  private readonly highlightRaan: number
  private readonly lineMaterials: LineBasicMaterial[] = []
  private groupOpacity = 1

  constructor(reticles: number, dpr: number) {
    const random = mulberry(4711)
    const data = new Color(0x6fb8e6)
    const action = new Color(0xecb44d)
    const tmp = new Vector3()

    FAMILIES.forEach((family) => {
      const radius = displayRadius(family.altitude)
      const raan = random() * Math.PI * 2
      const points: number[] = []
      const steps = 168
      for (let i = 0; i <= steps; i += 1) {
        orbitalPosition(radius, family.inclination, raan, (i / steps) * Math.PI * 2, tmp)
        points.push(tmp.x, tmp.y, tmp.z)
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(points), 3))
      const material = new LineBasicMaterial({
        color: 0x6fb8e6,
        transparent: true,
        opacity: family.lineOpacity,
        depthWrite: false,
      })
      this.lineMaterials.push(material)
      const line = new Line(geometry, material)
      line.frustumCulled = false
      this.group.add(line)

      // A second plane per family, offset in RAAN, reads as a shell not a ring.
      const second = new Line(
        geometry.clone(),
        new LineBasicMaterial({
          color: 0x6fb8e6,
          transparent: true,
          opacity: family.lineOpacity * 0.62,
          depthWrite: false,
        }),
      )
      this.lineMaterials.push(second.material as LineBasicMaterial)
      second.rotation.y = 1.1
      second.frustumCulled = false
      this.group.add(second)

      for (let i = 0; i < family.count; i += 1) {
        this.satellites.push({
          family,
          radius,
          raan: raan + (i % 2 === 0 ? 0 : 1.1),
          phase: random() * Math.PI * 2,
          rate: Math.sqrt(MU / Math.pow(EARTH_RADIUS_KM + family.altitude, 3)),
        })
      }
    })

    this.highlightRadius = displayRadius(FAMILIES[0].altitude)
    this.highlightInclination = FAMILIES[0].inclination
    this.highlightRaan = this.satellites[0].raan

    this.satPositions = new Float32Array(this.satellites.length * 3)
    const colors = new Float32Array(this.satellites.length * 3)
    const sizes = new Float32Array(this.satellites.length)
    this.satellites.forEach((_, index) => {
      const color = index === 0 ? action : data
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
      sizes[index] = index === 0 ? 3.4 : 2.2
    })

    this.satGeometry.setAttribute('position', new Float32BufferAttribute(this.satPositions, 3))
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
    const satPoints = new Points(this.satGeometry, this.satMaterial)
    satPoints.frustumCulled = false
    this.group.add(satPoints)

    for (let i = 0; i < reticles; i += 1) {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: this.fallbackReticleTexture,
          color: 0x6fb8e6,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      )
      sprite.scale.setScalar(0.13)
      this.reticles.push(sprite)
      this.group.add(sprite)
    }

    // The highlighted track's real ground track, projected from its orbit.
    const trackPoints: number[] = []
    const surface = SCENE_RADIUS * 1.012
    for (let i = 0; i <= 128; i += 1) {
      orbitalPosition(
        this.highlightRadius,
        this.highlightInclination,
        this.highlightRaan,
        (i / 128) * Math.PI * 2,
        tmp,
      )
        .normalize()
        .multiplyScalar(surface)
      trackPoints.push(tmp.x, tmp.y, tmp.z)
    }
    const trackGeometry = new BufferGeometry()
    trackGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(trackPoints), 3),
    )
    this.groundTrack = new Line(
      trackGeometry,
      new LineBasicMaterial({
        color: 0xecb44d,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    )
    this.groundTrack.frustumCulled = false
    this.group.add(this.groundTrack)

    this.footprint = new Mesh(
      new CircleGeometry(0.2, 48),
      new MeshBasicMaterial({
        color: 0xecb44d,
        transparent: true,
        opacity: 0.1,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    )
    this.footprint.frustumCulled = false
    this.group.add(this.footprint)

    this.update(0)
  }

  setPixelRatio(dpr: number): void {
    this.satMaterial.uniforms.uDpr.value = dpr
  }

  setCount(reticleCount: number): void {
    this.reticles.forEach((sprite, index) => {
      sprite.visible = index < reticleCount
    })
  }

  setOpacity(value: number): void {
    this.groupOpacity = Math.min(1, Math.max(0, value))
    this.group.visible = this.groupOpacity > 0.004
    this.satMaterial.uniforms.uOpacity.value = this.groupOpacity
    this.lineMaterials.forEach((material, index) => {
      material.opacity = (index % 2 === 0 ? 0.3 : 0.19) * this.groupOpacity
    })
    this.reticles.forEach((sprite) => {
      ;(sprite.material as SpriteMaterial).opacity = 0.42 * this.groupOpacity
    })
    ;(this.groundTrack.material as LineBasicMaterial).opacity = 0.5 * this.groupOpacity
    ;(this.footprint.material as MeshBasicMaterial).opacity = 0.1 * this.groupOpacity
  }

  update(time: number): void {
    const positions = this.satGeometry.getAttribute('position') as Float32BufferAttribute
    const tmp = new Vector3()

    this.satellites.forEach((satellite, index) => {
      const anomaly = satellite.phase + satellite.rate * time * DISPLAY_TIME
      orbitalPosition(satellite.radius, satellite.family.inclination, satellite.raan, anomaly, tmp)
      positions.setXYZ(index, tmp.x, tmp.y, tmp.z)
      if (index === 0) {
        const contact = tmp.clone().normalize().multiplyScalar(SCENE_RADIUS * 1.015)
        this.footprint.position.copy(contact)
        this.footprint.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), contact.clone().normalize())
      }
    })
    positions.needsUpdate = true

    const step = Math.max(1, Math.floor(this.satellites.length / Math.max(1, this.reticles.length)))
    this.reticles.forEach((sprite, index) => {
      const satellite = this.satellites[index * step]
      if (!satellite) return
      orbitalPosition(
        satellite.radius,
        satellite.family.inclination,
        satellite.raan,
        satellite.phase + satellite.rate * time * DISPLAY_TIME,
        tmp,
      )
      sprite.position.copy(tmp)
    })
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line || object instanceof Points) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      }
      if (object instanceof Sprite) {
        const material = object.material as SpriteMaterial
        material.dispose()
      }
    })
    this.fallbackReticleTexture.dispose()
  }
}
