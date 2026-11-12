import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from 'three'
import { landRings, latLonToVec, type Ring } from '../land'

const RADIUS = 1.55

/**
 * Major population centres as [lon, lat, weight]. Bundled rather than generated:
 * the night side should show the real shape of the world, not noise.
 */
const CITIES: Array<[number, number, number]> = [
  [-74.0, 40.7, 1], [-73.9, 42.7, 0.35], [-77.0, 38.9, 0.5], [-87.6, 41.9, 0.6], [-95.4, 29.8, 0.5],
  [-118.2, 34.1, 0.9], [-122.4, 37.8, 0.55], [-122.3, 47.6, 0.45], [-104.9, 39.7, 0.35], [-80.2, 25.8, 0.45],
  [-79.4, 43.7, 0.55], [-73.6, 45.5, 0.3], [-99.1, 19.4, 0.75], [-103.3, 20.7, 0.3], [-46.6, -23.5, 0.7],
  [-43.2, -22.9, 0.6], [-58.4, -34.6, 0.55], [-70.7, -33.4, 0.4], [-77.0, -12.0, 0.35], [-74.1, 4.7, 0.4],
  [0.1, 51.5, 0.95], [-0.1, 51.5, 0.4], [2.35, 48.9, 0.85], [4.9, 52.4, 0.5], [13.4, 52.5, 0.6], [11.6, 48.1, 0.4],
  [9.2, 45.5, 0.45], [12.5, 41.9, 0.45], [8.7, 50.1, 0.4], [3.7, 40.4, 0.5], [-3.7, 40.4, 0.55], [-9.1, 38.7, 0.35],
  [4.9, 45.8, 0.3], [6.1, 46.2, 0.25], [16.4, 48.2, 0.3], [21.0, 52.2, 0.3], [14.4, 50.1, 0.3], [19.0, 47.5, 0.28],
  [26.1, 44.4, 0.3], [23.7, 37.9, 0.35], [28.9, 41.0, 0.55], [31.2, 30.0, 0.5], [3.4, 6.5, 0.45], [7.5, 9.1, 0.3],
  [36.8, -1.3, 0.3], [18.4, -33.9, 0.35], [28.0, -26.2, 0.4], [31.0, -29.9, 0.3], [27.6, -11.7, 0.25],
  [37.6, 55.8, 0.7], [30.3, 59.9, 0.45], [24.9, 60.2, 0.25], [18.1, 59.3, 0.3], [10.7, 59.9, 0.25], [12.6, 55.7, 0.3],
  [13.4, 52.5, 0.4], [16.4, 48.2, 0.35], [21.0, 52.2, 0.35], [19.9, 50.1, 0.3], [30.5, 50.4, 0.4], [37.6, 55.8, 0.4],
  [44.8, 41.7, 0.3], [49.1, 55.8, 0.3], [60.6, 56.8, 0.3], [82.9, 55.0, 0.3], [92.9, 56.0, 0.2], [104.3, 52.3, 0.2],
  [69.2, 41.3, 0.35], [76.9, 43.2, 0.2], [51.4, 35.7, 0.55], [55.3, 25.2, 0.5], [46.7, 24.7, 0.45], [39.2, 21.5, 0.4],
  [72.9, 19.1, 0.85], [77.2, 28.6, 0.9], [77.6, 12.9, 0.65], [80.3, 13.1, 0.5], [88.4, 22.6, 0.7], [90.4, 23.8, 0.5],
  [100.5, 13.8, 0.75], [106.7, 10.8, 0.6], [105.8, 21.0, 0.45], [96.2, 16.8, 0.35], [101.7, 3.1, 0.5], [103.8, 1.3, 0.5],
  [106.8, -6.2, 0.6], [110.4, -7.0, 0.35], [112.8, -6.9, 0.35], [114.1, 22.3, 0.95], [113.3, 23.1, 0.8], [121.5, 31.2, 0.95],
  [116.4, 39.9, 0.95], [117.2, 39.1, 0.4], [123.4, 41.8, 0.4], [126.6, 37.6, 0.8], [127.0, 37.5, 0.5], [129.0, 35.2, 0.4],
  [135.5, 34.7, 0.85], [139.7, 35.7, 1], [136.9, 35.2, 0.5], [130.4, 33.6, 0.35], [141.4, 43.1, 0.25], [151.2, -33.9, 0.6],
  [145.0, -37.8, 0.5], [153.0, -27.5, 0.4], [115.9, -32.0, 0.3], [174.8, -36.8, 0.35], [31.2, -29.9, 0.3],
  [144.9, 13.5, 0.15], [-66.1, 18.5, 0.3], [-82.4, 23.1, 0.3], [-76.8, 18.0, 0.25], [-69.9, 18.5, 0.3],
  [55.3, 25.2, 0.6], [67.0, 24.9, 0.7], [74.3, 31.5, 0.7], [85.3, 27.7, 0.3], [120.6, 16.4, 0.35], [125.7, 7.1, 0.35],
]

const LIGHTS_VERTEX = /* glsl */ `
  attribute float aWeight;
  uniform vec3 uLight;
  varying float vWeight;
  varying float vNight;
  void main() {
    vec3 n = normalize(position);
    vWeight = aWeight;
    vNight = smoothstep(0.16, -0.14, dot(n, normalize(uLight)));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (1.4 + aWeight * 2.2) * (72.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`

const LIGHTS_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vWeight;
  varying float vNight;
  void main() {
    float falloff = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
    float alpha = falloff * vNight * uOpacity * (0.5 + vWeight * 0.5);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`

const SURFACE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const SURFACE_FRAGMENT = /* glsl */ `
  uniform vec3 uGround;
  uniform vec3 uSurface;
  uniform vec3 uLight;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uLight);
    float lit = dot(n, l);
    // A tighter terminator: the day side starts just past grazing, so the night
    // side is genuinely dark instead of a uniformly blue ball.
    float day = smoothstep(-0.04, 0.34, lit);
    float band = smoothstep(0.24, 0.0, abs(lit - 0.05));
    vec3 color = mix(uGround, uSurface, day * 0.95);
    color += uSurface * band * 0.12;
    // Ocean sheen: a broad, low-gloss highlight, strongest near the sub-solar point.
    vec3 h = normalize(l + normalize(vView));
    float spec = pow(max(dot(n, h), 0.0), 26.0) * smoothstep(0.05, 0.7, lit);
    color += vec3(0.26, 0.42, 0.58) * spec * 0.5;
    float limb = pow(1.0 - clamp(dot(n, normalize(vView)), 0.0, 1.0), 2.6);
    color += vec3(0.02, 0.05, 0.09) * limb;
    gl_FragColor = vec4(color, uOpacity);
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
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.4);
    gl_FragColor = vec4(uColor, rim * 0.5 * uOpacity);
    #include <colorspace_fragment>
  }
`

function segmentsFor(rings: Ring[], radius: number, maxJump = 24): Float32Array {
  const values: number[] = []
  rings.forEach((ring) => {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [lonA, latA] = ring[i]
      const [lonB, latB] = ring[i + 1]
      if (Math.abs(lonA - lonB) > maxJump * 2 || Math.abs(latA - latB) > maxJump) continue
      const a = latLonToVec(lonA, latA, radius)
      const b = latLonToVec(lonB, latB, radius)
      values.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
  })
  return new Float32Array(values)
}

function graticule(radius: number, step = 15): Float32Array {
  const values: number[] = []
  for (let lat = -75; lat <= 75; lat += step) {
    for (let lon = -180; lon < 180; lon += 4) {
      const a = latLonToVec(lon, lat, radius)
      const b = latLonToVec(lon + 4, lat, radius)
      values.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
  }
  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -88; lat < 88; lat += 4) {
      const a = latLonToVec(lon, lat, radius)
      const b = latLonToVec(lon, lat + 4, radius)
      values.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
  }
  return new Float32Array(values)
}

export class Globe {
  readonly group = new Group()
  readonly radius = RADIUS
  private readonly surface: ShaderMaterial
  private readonly rim: ShaderMaterial
  private readonly coasts: LineBasicMaterial
  private readonly grid: LineBasicMaterial
  private readonly lights: ShaderMaterial
  private spin = 0
  private velocity = 0
  private readonly shells: Mesh[] = []
  private rotation = 0

  constructor() {
    this.surface = new ShaderMaterial({
      vertexShader: SURFACE_VERTEX,
      fragmentShader: SURFACE_FRAGMENT,
      uniforms: {
        uGround: { value: new Color(0x191939) },
        uSurface: { value: new Color(0x1b3a68) },
        uLight: { value: [0.85, 0.32, 0.42] },
        uOpacity: { value: 1 },
      },
      side: FrontSide,
      transparent: true,
    })
    const body = new Mesh(new SphereGeometry(RADIUS, 96, 64), this.surface)
    body.frustumCulled = false
    this.shells.push(body)
    this.group.add(body)

    const coastGeometry = new BufferGeometry()
    coastGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(segmentsFor(landRings(), RADIUS * 1.003), 3),
    )
    this.coasts = new LineBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
    const coastLines = new LineSegments(coastGeometry, this.coasts)
    coastLines.frustumCulled = false
    this.group.add(coastLines)

    const gridGeometry = new BufferGeometry()
    gridGeometry.setAttribute('position', new Float32BufferAttribute(graticule(RADIUS * 1.001), 3))
    this.grid = new LineBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    })
    const gridLines = new LineSegments(gridGeometry, this.grid)
    gridLines.frustumCulled = false
    this.group.add(gridLines)

    const positions: number[] = []
    const weights: number[] = []
    CITIES.forEach(([lon, lat, weight]) => {
      const point = latLonToVec(lon, lat, RADIUS * 1.004)
      positions.push(point[0], point[1], point[2])
      weights.push(weight)
    })
    const lightGeometry = new BufferGeometry()
    lightGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    lightGeometry.setAttribute('aWeight', new Float32BufferAttribute(weights, 1))
    this.lights = new ShaderMaterial({
      vertexShader: LIGHTS_VERTEX,
      fragmentShader: LIGHTS_FRAGMENT,
      uniforms: {
        uColor: { value: new Color(0xf2e199) },
        uOpacity: { value: 1 },
        uLight: this.surface.uniforms.uLight,
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const cityLights = new Points(lightGeometry, this.lights)
    cityLights.frustumCulled = false
    this.group.add(cityLights)

    this.rim = new ShaderMaterial({
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
    const atmosphere = new Mesh(new SphereGeometry(RADIUS * 1.06, 64, 40), this.rim)
    atmosphere.frustumCulled = false
    this.shells.push(atmosphere)
    this.group.add(atmosphere)
  }

  setOpacity(value: number): void {
    const v = Math.min(1, Math.max(0, value))
    this.group.visible = v > 0.004
    this.surface.uniforms.uOpacity.value = v
    this.rim.uniforms.uOpacity.value = v
    this.lights.uniforms.uOpacity.value = v
    this.coasts.opacity = 0.42 * v
    this.grid.opacity = 0.12 * v
  }

  /** Fling the globe; the velocity decays so the drag reads as inertia. */
  drag(radians: number): void {
    this.rotation += radians
    this.velocity = radians * 60
    this.group.rotation.y = this.rotation
  }

  update(dt: number, motion: boolean): void {
    this.group.rotation.y = this.rotation + this.spin
    if (!motion) return
    // A slow baseline drift, plus whatever the last drag left behind.
    this.spin += dt * 0.0045
    if (Math.abs(this.velocity) > 0.0004) {
      this.rotation += this.velocity * dt
      this.velocity *= Math.exp(-dt * 2.4)
      this.group.rotation.y = this.rotation + this.spin
    }
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
