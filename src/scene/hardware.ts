import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
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
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  FrontSide,
  type Side,
} from 'three'

export type PartKey = 'payload' | 'bus' | 'array' | 'antenna'

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
  uniform vec3 uFill;
  uniform vec3 uRim;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.1);
    vec3 color = mix(uFill, uRim, fresnel * 0.92);
    gl_FragColor = vec4(color, (0.72 + fresnel * 0.28) * uOpacity);
    #include <colorspace_fragment>
  }
`

interface Part {
  key: PartKey
  pivot: Group
  base: Vector3
  direction: Vector3
  distance: number
}

export class Hardware {
  readonly group = new Group()
  private readonly parts: Part[] = []
  private readonly fades: Array<(value: number) => void> = []
  private readonly anchors = new Map<PartKey, Object3D>()
  private readonly fill = new Color(0x1b3a68).multiplyScalar(0.5)
  private readonly rim = new Color(0x6fb8e6)

  constructor() {
    const root = new Group()
    this.group.add(root)

    const makeRimMaterial = (side: Side = FrontSide): ShaderMaterial => {
      const material = new ShaderMaterial({
        vertexShader: RIM_VERTEX,
        fragmentShader: RIM_FRAGMENT,
        uniforms: {
          uFill: { value: this.fill.clone() },
          uRim: { value: this.rim.clone() },
          uOpacity: { value: 1 },
        },
        transparent: true,
        depthWrite: true,
        side,
      })
      this.fades.push((value) => {
        material.uniforms.uOpacity.value = value
      })
      return material
    }

    const edgeMaterial = new LineBasicMaterial({
      color: 0x6fb8e6,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    })
    this.fades.push((value) => {
      edgeMaterial.opacity = 0.52 * value
    })

    const addEdges = (mesh: Mesh, geometry: BufferGeometry, customMaterial?: LineBasicMaterial): void => {
      const line = new LineSegments(new EdgesGeometry(geometry, 28), customMaterial ?? edgeMaterial)
      line.frustumCulled = false
      line.renderOrder = 3
      mesh.add(line)
    }

    const addPart = (
      key: PartKey,
      pivot: Group,
      base: Vector3,
      direction: Vector3,
      distance: number,
    ): void => {
      pivot.position.copy(base)
      root.add(pivot)
      this.parts.push({ key, pivot, base, direction, distance })
    }

    // Bus
    const busPivot = new Group()
    addPart('bus', busPivot, new Vector3(0, 0, 0), new Vector3(0, 0, 0), 0)
    const busGeometry = new BoxGeometry(1.05, 0.72, 0.72)
    const bus = new Mesh(busGeometry, makeRimMaterial())
    busPivot.add(bus)
    addEdges(bus, busGeometry)
    const busAnchor = new Object3D()
    busAnchor.position.set(0.38, 0.3, 0.34)
    bus.add(busAnchor)
    this.anchors.set('bus', busAnchor)

    // Optical payload
    const payloadPivot = new Group()
    addPart('payload', payloadPivot, new Vector3(0, 0.04, 0.36), new Vector3(0, 0, 1), 0.6)
    const barrelGeometry = new CylinderGeometry(0.2, 0.28, 0.9, 28)
    const barrel = new Mesh(barrelGeometry, makeRimMaterial())
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = 0.45
    payloadPivot.add(barrel)
    addEdges(barrel, barrelGeometry)

    const apertureMaterial = new MeshBasicMaterial({
      color: 0xecb44d,
      transparent: true,
      opacity: 0.92,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    this.fades.push((value) => {
      apertureMaterial.opacity = 0.92 * value
    })
    const aperture = new Mesh(new CircleGeometry(0.185, 36), apertureMaterial)
    aperture.position.set(0, 0, 0.905)
    payloadPivot.add(aperture)

    const apertureRing = new Mesh(
      new CircleGeometry(0.13, 32),
      new MeshBasicMaterial({
        color: 0x191939,
        transparent: true,
        opacity: 0.68,
        side: DoubleSide,
        depthWrite: false,
      }),
    )
    apertureRing.position.set(0, 0, 0.906)
    payloadPivot.add(apertureRing)

    const payloadAnchor = new Object3D()
    payloadAnchor.position.set(0.16, 0.2, 0.94)
    payloadPivot.add(payloadAnchor)
    this.anchors.set('payload', payloadAnchor)

    // Solar arrays
    const addArray = (sign: 1 | -1): void => {
      const pivot = new Group()
      addPart('array', pivot, new Vector3(sign * 0.55, 0, 0), new Vector3(sign, 0.05, 0), 0.55)
      const boom = new Mesh(new CylinderGeometry(0.028, 0.028, 0.5, 12), makeRimMaterial())
      boom.rotation.z = Math.PI / 2
      boom.position.x = sign * 0.25
      pivot.add(boom)

      const panelGeometry = new BoxGeometry(1.4, 0.035, 0.62)
      const panel = new Mesh(panelGeometry, makeRimMaterial())
      panel.position.x = sign * 0.95
      pivot.add(panel)
      addEdges(panel, panelGeometry)

      if (sign === 1) {
        const anchor = new Object3D()
        anchor.position.set(0.52, 0.06, 0.24)
        panel.add(anchor)
        this.anchors.set('array', anchor)
      }
    }
    addArray(-1)
    addArray(1)

    // Crosslink antenna
    const antennaPivot = new Group()
    addPart('antenna', antennaPivot, new Vector3(0, 0.46, -0.05), new Vector3(0, 1, 0), 0.5)
    const stalk = new Mesh(new CylinderGeometry(0.028, 0.032, 0.3, 12), makeRimMaterial())
    stalk.position.y = 0.12
    antennaPivot.add(stalk)

    const dishGeometry = new SphereGeometry(0.26, 30, 14, 0, Math.PI * 2, 0, Math.PI / 2.5)
    const dish = new Mesh(dishGeometry, makeRimMaterial(DoubleSide))
    dish.position.y = 0.34
    antennaPivot.add(dish)
    addEdges(dish, dishGeometry)

    const feed = new Mesh(new CylinderGeometry(0.012, 0.012, 0.2, 8), makeRimMaterial())
    feed.position.y = 0.44
    antennaPivot.add(feed)

    const antennaAnchor = new Object3D()
    antennaAnchor.position.set(0.06, 0.5, 0)
    antennaPivot.add(antennaAnchor)
    this.anchors.set('antenna', antennaAnchor)
  }

  setExplode(progress: number): void {
    const p = Math.min(1, Math.max(0, progress))
    this.parts.forEach((part) => {
      part.pivot.position.copy(part.base).addScaledVector(part.direction, part.distance * p)
    })
    this.group.updateWorldMatrix(true, true)
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
