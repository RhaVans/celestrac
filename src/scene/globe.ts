import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from 'three'
import { fbm3, mulberry } from './noise'

const RADIUS = 1.55

const DOT_VERTEX = /* glsl */ `
  uniform float uDpr;
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uDpr * (5.0 / max(0.1, -mv.z));
    vAlpha = aAlpha;
  }
`

const DOT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float alpha = smoothstep(1.0, 0.28, d) * vAlpha * uOpacity;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

const RIM_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const RIM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.1);
    gl_FragColor = vec4(uColor, rim * 0.42 * uOpacity);
    #include <colorspace_fragment>
  }
`

function graticulePositions(radius: number): Float32Array {
  const values: number[] = []
  const segments = 96

  for (let lat = -75; lat <= 75; lat += 15) {
    const phi = (lat * Math.PI) / 180
    const y = Math.sin(phi) * radius
    const ring = Math.cos(phi) * radius
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2
      const b = ((i + 1) / segments) * Math.PI * 2
      values.push(Math.cos(a) * ring, y, Math.sin(a) * ring)
      values.push(Math.cos(b) * ring, y, Math.sin(b) * ring)
    }
  }

  for (let lon = 0; lon < 180; lon += 15) {
    const theta = (lon * Math.PI) / 180
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2
      const b = ((i + 1) / segments) * Math.PI * 2
      values.push(Math.cos(a) * cos * radius, Math.sin(a) * radius, Math.cos(a) * sin * radius)
      values.push(Math.cos(b) * cos * radius, Math.sin(b) * radius, Math.cos(b) * sin * radius)
    }
  }

  return new Float32Array(values)
}

export class Globe {
  readonly group = new Group()
  readonly radius = RADIUS
  private readonly dotMaterial: ShaderMaterial
  private readonly atmosphereMaterial: ShaderMaterial
  private readonly graticuleMaterial: LineBasicMaterial
  private readonly dots: Points
  private rotation = 0

  constructor(count: number, dpr: number) {
    const random = mulberry(991817)
    const candidates = Math.max(count * 4, 40_000)
    const positions: number[] = []
    const sizes: number[] = []
    const alphas: number[] = []

    for (let i = 0; i < candidates && positions.length / 3 < count; i += 1) {
      const y = 1 - (i / (candidates - 1)) * 2
      const ring = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = i * 2.399963229728653
      const x = Math.cos(theta) * ring
      const z = Math.sin(theta) * ring

      const density = fbm3(x * 1.65 + 3.1, y * 1.65 + 7.7, z * 1.65 + 1.4)
      const shaped = Math.min(1, Math.max(0, (density - 0.38) / 0.3))
      const probability = shaped * shaped * (3 - 2 * shaped)
      if (random() > 0.16 + probability * 0.84) continue

      positions.push(x * RADIUS, y * RADIUS, z * RADIUS)
      sizes.push(0.85 + random() * 1.35)
      alphas.push(0.28 + random() * 0.62)
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('aSize', new Float32BufferAttribute(new Float32Array(sizes), 1))
    geometry.setAttribute('aAlpha', new Float32BufferAttribute(new Float32Array(alphas), 1))

    this.dotMaterial = new ShaderMaterial({
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      uniforms: {
        uColor: { value: new Color(0x1b3a68) },
        uOpacity: { value: 0.46 },
        uDpr: { value: dpr },
      },
      transparent: true,
      depthWrite: false,
    })

    this.dots = new Points(geometry, this.dotMaterial)
    this.dots.frustumCulled = false

    const graticule = new BufferGeometry()
    graticule.setAttribute('position', new Float32BufferAttribute(graticulePositions(RADIUS * 1.008), 3))
    this.graticuleMaterial = new LineBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    })
    const graticuleLines = new LineSegments(graticule, this.graticuleMaterial)
    graticuleLines.frustumCulled = false

    this.atmosphereMaterial = new ShaderMaterial({
      vertexShader: RIM_VERTEX,
      fragmentShader: RIM_FRAGMENT,
      uniforms: {
        uColor: { value: new Color(0x6fb8e6) },
        uOpacity: { value: 1 },
      },
      transparent: true,
      side: BackSide,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    const atmosphere = new Mesh(new SphereGeometry(RADIUS * 1.075, 48, 32), this.atmosphereMaterial)
    atmosphere.frustumCulled = false

    this.group.add(graticuleLines)
    this.group.add(this.dots)
    this.group.add(atmosphere)
  }

  setPixelRatio(dpr: number): void {
    this.dotMaterial.uniforms.uDpr.value = dpr
  }

  setCount(count: number): void {
    const total = this.dots.geometry.getAttribute('position').count
    this.dots.geometry.setDrawRange(0, Math.min(count, total))
  }

  setOpacity(value: number): void {
    this.dotMaterial.uniforms.uOpacity.value = 0.46 * value
    this.atmosphereMaterial.uniforms.uOpacity.value = value
    this.graticuleMaterial.opacity = 0.12 * value
  }

  update(dt: number, motion: boolean): void {
    if (!motion) return
    this.rotation += dt * 0.036
    this.group.rotation.y = this.rotation
  }

  dispose(): void {
    this.dots.geometry.dispose()
    this.dotMaterial.dispose()
    this.atmosphereMaterial.dispose()
    this.graticuleMaterial.dispose()
  }
}
