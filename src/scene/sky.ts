import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  RingGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three'
import { mulberry } from './noise'

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aHalo;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vHalo;
  varying float vAlpha;

  vec3 potential(vec3 p) {
    return vec3(
      sin(p.y * 1.3 + uTime * 0.11) * cos(p.z * 0.9 - uTime * 0.07)
        + 0.5 * sin(p.z * 2.1 + p.x * 0.7),
      sin(p.z * 1.1 - uTime * 0.09) * cos(p.x * 1.2 + uTime * 0.05)
        + 0.5 * sin(p.x * 1.9 + p.y * 0.6),
      sin(p.x * 0.9 + uTime * 0.08) * cos(p.y * 1.4 - uTime * 0.06)
        + 0.5 * sin(p.y * 2.2 + p.z * 0.8)
    );
  }

  vec3 curlNoise(vec3 p) {
    const float e = 0.32;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    vec3 px0 = potential(p - dx);
    vec3 px1 = potential(p + dx);
    vec3 py0 = potential(p - dy);
    vec3 py1 = potential(p + dy);
    vec3 pz0 = potential(p - dz);
    vec3 pz1 = potential(p + dz);
    return vec3(
      (py1.z - py0.z) - (pz1.y - pz0.y),
      (pz1.x - pz0.x) - (px1.z - px0.z),
      (px1.y - px0.y) - (py1.x - py0.x)
    ) / (2.0 * e);
  }

  void main() {
    vec3 p = position;
    vec3 flow = curlNoise(p * 0.055);
    p += flow * (1.0 + aHalo * 1.6) * uFlow;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (30.0 / max(0.1, -mv.z)) * (1.0 + aHalo * 0.9);

    vColor = aColor;
    vHalo = aHalo;
    vAlpha = aAlpha;
  }
`

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vHalo;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;

    float core = smoothstep(1.0, 0.24, d);
    float halo = pow(max(0.0, 1.0 - d), 3.0) * vHalo;
    float alpha = (core + halo * 0.5) * vAlpha;

    gl_FragColor = vec4(vColor * (1.0 + vHalo * 0.45), alpha);
    #include <colorspace_fragment>
  }
`

export class Sky {
  readonly object = new Points()
  readonly crescent = new Group()
  private readonly material: ShaderMaterial
  private readonly crescentHalo: Sprite
  private readonly dpr: number

  constructor(count: number, dpr: number) {
    this.dpr = dpr
    const random = mulberry(20260317)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const halos = new Float32Array(count)
    const alphas = new Float32Array(count)

    const light = new Color(0xf2e199)
    const data = new Color(0x6fb8e6)
    const action = new Color(0xecb44d)

    for (let i = 0; i < count; i += 1) {
      const u = random() * Math.PI * 2
      const v = Math.acos(2 * random() - 1)
      const radius = 26 + random() * 23
      positions[i * 3] = Math.sin(v) * Math.cos(u) * radius
      positions[i * 3 + 1] = Math.cos(v) * radius
      positions[i * 3 + 2] = Math.sin(v) * Math.sin(u) * radius

      const pick = random()
      const color = pick > 0.982 ? action : pick > 0.84 ? data : light
      const tint = 0.72 + random() * 0.28
      colors[i * 3] = color.r * tint
      colors[i * 3 + 1] = color.g * tint
      colors[i * 3 + 2] = color.b * tint

      const bright = random() > 0.955
      sizes[i] = (bright ? 2.2 : 0.9) + random() * (bright ? 2.4 : 1.4)
      halos[i] = bright ? 1 : 0
      alphas[i] = bright ? 0.95 : 0.32 + random() * 0.5
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
        uPixelRatio: { value: dpr },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })

    this.object.geometry = geometry
    this.object.material = this.material
    this.object.frustumCulled = false
    this.object.renderOrder = -10

    // A single thin crescent arc with a soft additive halo, placed off-axis.
    const arc = new Mesh(
      new RingGeometry(1, 1.07, 96, 1, 0.55, 1.65),
      new MeshBasicMaterial({
        color: 0xf2e199,
        transparent: true,
        opacity: 0.72,
        side: 2,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    )

    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
      gradient.addColorStop(0, 'rgba(242, 225, 153, 0.42)')
      gradient.addColorStop(0.5, 'rgba(242, 225, 153, 0.12)')
      gradient.addColorStop(1, 'rgba(242, 225, 153, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 128, 128)
    }

    this.crescentHalo = new Sprite(
      new SpriteMaterial({
        map: new CanvasTexture(canvas),
        transparent: true,
        opacity: 0.8,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.crescentHalo.scale.setScalar(4.6)

    this.crescent.add(arc)
    this.crescent.add(this.crescentHalo)
    this.crescent.position.set(-11, 10.5, -27)
    this.crescent.rotation.set(0.16, -0.28, -0.38)
    this.crescent.renderOrder = -9
    this.object.add(this.crescent)
  }

  setPixelRatio(dpr: number): void {
    this.material.uniforms.uPixelRatio.value = dpr
  }

  setCount(count: number): void {
    const geometry = this.object.geometry
    geometry.setDrawRange(0, Math.min(count, geometry.getAttribute('position').count))
  }

  update(time: number, flow: number): void {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uFlow.value = flow
  }

  setLayout(isMobile: boolean): void {
    this.crescent.position.set(isMobile ? -5 : -11, isMobile ? 9 : 10.5, -27)
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.material.dispose()
    this.crescentHalo.material.map?.dispose()
    this.crescentHalo.material.dispose()
  }

  get pixelRatio(): number {
    return this.dpr
  }
}
