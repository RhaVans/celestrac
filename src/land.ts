import landTopo from 'world-atlas/land-110m.json'
import { mesh } from 'topojson-client'
import type { GeometryObject, Topology } from 'topojson-specification'

/** Coastline rings in degrees: [longitude, latitude] pairs. */
export type Ring = number[][]

let rings: Ring[] | null = null

/**
 * Natural Earth 110m land, shared by the WebGL globe, the Orrery map and the
 * build-time poster so all three draw the same coastlines.
 */
export function landRings(): Ring[] {
  if (rings) return rings
  const topology = landTopo as unknown as Topology
  const land = (landTopo as unknown as { objects: Record<string, GeometryObject> }).objects.land
  const outline = mesh(topology, land) as unknown as {
    type: string
    coordinates: Ring[]
  }
  rings = (outline.type === 'MultiLineString' ? outline.coordinates : []).filter(
    (ring) => ring.length > 1,
  )
  return rings
}

export function latLonToVec(lon: number, lat: number, radius: number): [number, number, number] {
  const phi = (lat * Math.PI) / 180
  const lambda = (lon * Math.PI) / 180
  const cos = Math.cos(phi)
  return [cos * Math.cos(lambda) * radius, Math.sin(phi) * radius, cos * Math.sin(lambda) * radius]
}
