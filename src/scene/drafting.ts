import { PerspectiveCamera, Vector3 } from 'three'
import type { Hardware, PartKey } from './hardware'

type Layout = 'above' | 'right' | 'leader'

interface Dimension {
  a: PartKey
  b: PartKey
  label: string
  layout: Layout
  extension: SVGPathElement[]
  measure: SVGPathElement
  text: HTMLElement
}

const clamp = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * The drafting overlay. Every line here carries a real measurement; the
 * stroke-dashoffset reveal is the hardware separation's signature moment.
 *
 * Placement rules, learned from looking at the render: the array span sits
 * above the wings, the bus height sits clear to the right of the body, and the
 * aperture gets a leader that leaves the frame's lower left, where the spec
 * list lives.
 */
export class Drafting {
  private readonly dimensions: Dimension[] = []
  private readonly labelHost: HTMLElement
  private reveal = 0
  private readonly va = new Vector3()
  private readonly vb = new Vector3()

  constructor(svg: SVGSVGElement, labelHost: HTMLElement) {
    this.labelHost = labelHost
    const group = svg.querySelector<SVGGElement>('#draft-lines')
    if (!group) return

    const create = (a: PartKey, b: PartKey, label: string, layout: Layout): void => {
      const extension = [0, 1].map(() => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('stroke-opacity', '0.5')
        group.appendChild(path)
        return path
      })
      const measure = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      measure.setAttribute('stroke-opacity', '0.85')
      group.appendChild(measure)

      const text = document.createElement('span')
      text.className = 'draft-label annot'
      text.textContent = label
      labelHost.appendChild(text)

      this.dimensions.push({ a, b, label, layout, extension, measure, text })
    }

    create('arrayL', 'arrayR', 'Array span 2.40 m', 'above')
    create('busTop', 'busBottom', 'Bus 1.10 m', 'right')
    create('aperture', 'aperture', 'Aperture Ø 0.42 m', 'leader')
  }

  setProgress(value: number): void {
    this.reveal = clamp(value)
  }

  update(camera: PerspectiveCamera, hardware: Hardware, width: number, height: number): void {
    if (this.dimensions.length === 0) return
    const narrow = width < 900
    let labelsVisible = 0

    this.dimensions.forEach((dimension, index) => {
      const [ax, ay] = this.project(dimension.a, camera, hardware, width, height)
      const [bx, by] = this.project(dimension.b, camera, hardware, width, height)
      const start = 0.1 + index * 0.1
      const t = clamp((this.reveal - start) / 0.45)
      const extT = clamp(t * 2.2)
      const measureT = clamp((t - 0.3) / 0.7)

      const hide = narrow && dimension.layout !== 'above'
      if (hide) {
        dimension.measure.setAttribute('d', '')
        dimension.extension.forEach((path) => path.setAttribute('d', ''))
        dimension.text.style.opacity = '0'
        return
      }

      if (dimension.layout === 'above') {
        const y = Math.min(ay, by) - 38
        dimension.extension[0].setAttribute('d', `M${ax} ${ay} L${ax} ${y + 5}`)
        dimension.extension[1].setAttribute('d', `M${bx} ${by} L${bx} ${y + 5}`)
        dimension.measure.setAttribute(
          'd',
          `M${ax} ${y} L${bx} ${y} M${ax} ${y - 5} L${ax} ${y + 5} M${bx} ${y - 5} L${bx} ${y + 5}`,
        )
        this.revealPath(dimension.extension[0], extT, Math.abs(y - ay) + 6)
        this.revealPath(dimension.extension[1], extT, Math.abs(y - by) + 6)
        this.revealPath(dimension.measure, measureT, Math.abs(bx - ax))
        // Left-aligned at the span's start so it cannot stack on the aperture leader.
        this.place(dimension.text, ax + 4, y - 20, 'left', width, height)
        labelsVisible = Math.max(labelsVisible, measureT)
      } else if (dimension.layout === 'right') {
        const x = Math.max(ax, bx) + 54
        dimension.extension[0].setAttribute('d', `M${ax} ${ay} L${x + 5} ${ay}`)
        dimension.extension[1].setAttribute('d', `M${bx} ${by} L${x + 5} ${by}`)
        dimension.measure.setAttribute(
          'd',
          `M${x} ${ay} L${x} ${by} M${x - 5} ${ay} L${x + 5} ${ay} M${x - 5} ${by} L${x + 5} ${by}`,
        )
        this.revealPath(dimension.extension[0], extT, Math.abs(x - ax) + 6)
        this.revealPath(dimension.extension[1], extT, Math.abs(x - bx) + 6)
        this.revealPath(dimension.measure, measureT, Math.abs(by - ay))
        this.place(dimension.text, x + 10, (ay + by) / 2 - 8, 'left', width, height)
        labelsVisible = Math.max(labelsVisible, measureT)
      } else {
        // Down and left, into the empty ground under the payload, clear of both
        // the bus and the spec list.
        const elbowX = ax - 34
        const elbowY = ay + 66
        dimension.measure.setAttribute(
          'd',
          `M${ax} ${ay} L${elbowX} ${elbowY} M${elbowX} ${elbowY} L${elbowX - 30} ${elbowY}`,
        )
        dimension.extension.forEach((path) => path.setAttribute('d', ''))
        this.revealPath(dimension.measure, measureT, 66 + 30)
        this.place(dimension.text, elbowX - 36, elbowY - 8, 'right', width, height)
        labelsVisible = Math.max(labelsVisible, measureT)
      }
    })

    this.labelHost.style.opacity = String(0.1 + labelsVisible * 0.9)
  }

  private revealPath(path: SVGPathElement, t: number, length: number): void {
    const dash = Math.max(1, length)
    path.setAttribute('stroke-dasharray', String(dash))
    path.setAttribute('stroke-dashoffset', String(dash * (1 - clamp(t))))
  }

  private place(
    text: HTMLElement,
    x: number,
    y: number,
    align: 'left' | 'center' | 'right',
    width: number,
    height: number,
  ): void {
    const w = text.offsetWidth || 120
    let left = x
    if (align === 'center') left = x - w / 2
    if (align === 'right') left = x - w
    left = Math.min(width - w - 12, Math.max(12, left))
    const top = Math.min(height - 34, Math.max(60, y))
    text.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    text.style.opacity = String(clamp(this.reveal * 1.5))
  }

  private project(
    key: PartKey,
    camera: PerspectiveCamera,
    hardware: Hardware,
    width: number,
    height: number,
  ): [number, number] {
    hardware.getAnchor(key, key === 'aperture' ? this.vb : this.va)
    const point = key === 'aperture' ? this.vb : this.va
    point.project(camera)
    return [(point.x * 0.5 + 0.5) * width, (-point.y * 0.5 + 0.5) * height]
  }

  resize(width: number, height: number): void {
    const svg = this.labelHost.previousElementSibling
    if (svg instanceof SVGSVGElement) svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }
}
