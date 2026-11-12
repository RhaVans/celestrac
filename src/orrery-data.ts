import { mulberry } from './scene/noise'

export interface TrackStep {
  name: string
  note: string
  latency: number
}

export interface Track {
  id: string
  type: string
  source: string
  confidence: number
  age: number
  lat: number
  lon: number
  steps: TrackStep[]
}

const KINDS = [
  {
    type: 'Vessel',
    sources: ['AIS feed', 'Partner SAR', 'Tycho-1 optical'],
    footprint: 26,
  },
  {
    type: 'Aircraft',
    sources: ['Partner ADS-B', 'Tycho-1 optical', 'Sextant ground'],
    footprint: 18,
  },
  {
    type: 'Orbital object',
    sources: ['Tycho-2 optical', 'Sextant ground', 'Partner radar'],
    footprint: 34,
  },
  {
    type: 'Ground vehicle',
    sources: ['Partner SAR', 'Tycho-1 optical', 'Sextant ground'],
    footprint: 12,
  },
  {
    type: 'Thermal anomaly',
    sources: ['Tycho-2 thermal', 'Partner SAR', 'AIS feed'],
    footprint: 22,
  },
]

/** Deterministic sample set: same 40 rows on every load. */
function build(): Track[] {
  const random = mulberry(1041)
  const tracks: Track[] = []

  for (let i = 0; i < 40; i += 1) {
    const kind = KINDS[Math.floor(random() * KINDS.length)]
    const confidence = 62 + Math.floor(random() * 38)
    const age = 2 + Math.floor(random() * 430)
    const source = kind.sources[Math.floor(random() * kind.sources.length)]
    const fuse = 0.6 + random() * 0.6
    const decide = 0.3 + random() * 0.6
    const deliver = 0.8 + random() * 1.5

    tracks.push({
      id: `TRK-${String(104 + i * 7).padStart(4, '0')}`,
      type: kind.type,
      source,
      confidence,
      age,
      lat: -58 + random() * 122,
      lon: -176 + random() * 352,
      steps: [
        {
          name: 'Sense',
          note: `${source} frame, ${(0.4 + random() * 0.5).toFixed(1)} m ground sample`,
          latency: 0,
        },
        { name: 'Fuse', note: 'Matched against two independent feeds', latency: fuse },
        { name: 'Decide', note: 'Analyst confirms the classification', latency: decide },
        { name: 'Deliver', note: 'Pushed to the field terminal', latency: deliver },
      ],
    })
  }

  return tracks
}

export const TRACKS: Track[] = build()

export function footprintFor(track: Track): number {
  const kind = KINDS.find((entry) => entry.type === track.type)
  return kind ? kind.footprint : 20
}

export function ageLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
