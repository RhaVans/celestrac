import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  RingGeometry,
  ShaderMaterial,
} from 'three'
import { mulberry } from './noise'

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform float uPixelRatio;
  uniform vec2 uParallax;
  attribute float aSize;
  attribute float aHalo;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vHalo;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    // Halos only: a slow drift, so the field is not a dead texture.
    float drift = sin(p.y * 0.08 + uTime * 0.05) * cos(p.x * 0.07 - uTime * 0.04);
    p.xy += uParallax * (0.4 + aHalo * 1.6);
    p.z += drift * aHalo * uFlow * 1.1;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (24.0 / max(0.1, -mv.z)) * (1.0 + aHalo * 0.8);

    vColor = aColor;
    vHalo = aHalo;
    vAlpha = aAlpha;
  }
`

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vHalo;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.3, d);
    float halo = pow(max(0.0, 1.0 - d), 3.0) * vHalo;
    gl_FragColor = vec4(vColor * (1.0 + vHalo * 0.35), (core + halo * 0.5) * vAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`

export class Sky {
  readonly object = new Points()
  readonly crescent = new Group()
  private readonly material: ShaderMaterial
  private readonly arcMaterials: MeshBasicMaterial[] = []

  constructor(count: number, dpr: number) {
    const random = mulberry(20260317)
    const total = Math.min(count, 20_000)
    const positions = new Float32Array(total * 3)
    const colors = new Float32Array(total * 3)
    const sizes = new Float32Array(total)
    const halos = new Float32Array(total)
    const alphas = new Float32Array(total)

    const light = new Color(0xf2e199)
    const tint = new Color(0x6fb8e6)

    for (let i = 0; i < total; i += 1) {
      const u = random() * Math.PI * 2
      const v = Math.acos(2 * random() - 1)
      const radius = 26 + random() * 24
      positions[i * 3] = Math.sin(v) * Math.cos(u) * radius
      positions[i * 3 + 1] = Math.cos(v) * radius
      positions[i * 3 + 2] = Math.sin(v) * Math.sin(u) * radius

      const cool = random() > 0.9
      const color = cool ? tint : light
      const f = 0.66 + random() * 0.34
      colors[i * 3] = color.r * f
      colors[i * 3 + 1] = color.g * f
      colors[i * 3 + 2] = color.b * f

      const halo = random() > 0.976 ? 1 : 0
      sizes[i] = (halo ? 2.0 : 0.85) + random() * (halo ? 1.9 : 1.15)
      halos[i] = halo
      alphas[i] = halo ? 0.92 : 0.28 + random() * 0.46
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
    geometry.setAttribute('aHalo', new Float32BufferAttribute(halos, 1))
    geometry.setAttribute('aAlpha', new Float32BufferAttribute(alphas, 1))

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uFlow: { value: 1 },
        uOpacity: { value: 1 },
        uPixelRatio: { value: dpr },
        uParallax: { value: [0, 0] },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })

    this.object.geometry = geometry
    this.object.material = this.material
    this.object.frustumCulled = false
    this.object.renderOrder = -10

    // One off-axis crescent, built from three additive arcs. No gradient objects.
    const arcs = [
      { radius: 1, width: 0.055, opacity: 0.72 },
      { radius: 1.05, width: 0.03, opacity: 0.3 },
      { radius: 1.1, width: 0.016, opacity: 0.13 },
    ]
    arcs.forEach(({ radius, width, opacity }) => {
      const material = new MeshBasicMaterial({
        color: 0xf2e199,
        transparent: true,
        opacity,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      })
      this.arcMaterials.push(material)
      const arc = new Mesh(new RingGeometry(radius, radius + width, 96, 1, 0.62, 1.5), material)
      this.crescent.add(arc)
    })

    this.crescent.position.set(-13, 11.5, -30)
    this.crescent.rotation.set(0.18, -0.3, -0.42)
    this.crescent.scale.setScalar(2.4)
    this.crescent.renderOrder = -9
    this.object.add(this.crescent)
  }

  setPixelRatio(dpr: number): void {
    this.material.uniforms.uPixelRatio.value = dpr
  }

  setCount(count: number): void {
    const total = this.object.geometry.getAttribute('position').count
    this.object.geometry.setDrawRange(0, Math.min(count, total))
  }

  setParallax(x: number, y: number): void {
    const value = this.material.uniforms.uParallax.value as number[]
    value[0] = x
    value[1] = y
  }

  update(time: number, flow: number): void {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uFlow.value = flow
  }

  setLayout(isMobile: boolean): void {
    this.crescent.position.set(isMobile ? -6 : -13, isMobile ? 10 : 11.5, -30)
    this.crescent.scale.setScalar(isMobile ? 1.5 : 2.4)
  }

  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = value
    this.arcMaterials.forEach((material, index) => {
      material.opacity = [0.72, 0.3, 0.13][index] * value
    })
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.material.dispose()
    this.arcMaterials.forEach((material) => material.dispose())
  }
}
