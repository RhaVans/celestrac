export type Tier = 'high' | 'low'

export interface Quality {
  tier: Tier
  stars: number
  reticles: number
  dpr: number
}

const cap = (value: number, limit: number): number => Math.min(value || 1, limit)

export function detectQuality(): Quality {
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 8
  const dpr = window.devicePixelRatio || 1
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  const low = Boolean(connection?.saveData) || coarse || cores <= 4 || dpr >= 2.6
  return low ? lowQuality(dpr) : highQuality(dpr)
}

export function highQuality(dpr = window.devicePixelRatio || 1): Quality {
  return { tier: 'high', stars: 20_000, reticles: 6, dpr: cap(dpr, 1.75) }
}

export function lowQuality(dpr = window.devicePixelRatio || 1): Quality {
  return { tier: 'low', stars: 9_000, reticles: 3, dpr: cap(dpr, 1.5) }
}

/** One downgrade only, as in v1: drops DPR first, then star and reticle counts. */
export function degradeQuality(current: Quality): Quality {
  return {
    tier: 'low',
    stars: Math.min(current.stars, 9_000),
    reticles: Math.min(current.reticles, 3),
    dpr: 1,
  }
}
