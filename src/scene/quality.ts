export type Tier = 'high' | 'low'

export interface Quality {
  tier: Tier
  stars: number
  globeDots: number
  orbitCount: number
  satelliteCount: number
  reticleCount: number
  dpr: number
}

const clampDpr = (value: number, cap: number) => Math.min(value || 1, cap)

export function detectQuality(): Quality {
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 8
  const dpr = window.devicePixelRatio || 1
  const low = coarse || cores <= 4 || dpr >= 3

  return low ? lowQuality(dpr) : highQuality(dpr)
}

export function highQuality(dpr = window.devicePixelRatio || 1): Quality {
  return {
    tier: 'high',
    stars: 50_000,
    globeDots: 22_000,
    orbitCount: 7,
    satelliteCount: 16,
    reticleCount: 5,
    dpr: clampDpr(dpr, 1.75),
  }
}

export function lowQuality(dpr = window.devicePixelRatio || 1): Quality {
  return {
    tier: 'low',
    stars: 16_000,
    globeDots: 9_000,
    orbitCount: 5,
    satelliteCount: 10,
    reticleCount: 2,
    dpr: clampDpr(dpr, 1.5),
  }
}

/**
 * One downgrade only: pixel ratio first, then geometry counts.
 * The high-tier buffers stay allocated and are drawn down via draw range.
 */
export function degradeQuality(current: Quality): Quality {
  return {
    tier: 'low',
    stars: Math.min(current.stars, 16_000),
    globeDots: Math.min(current.globeDots, 9_000),
    orbitCount: Math.min(current.orbitCount, 5),
    satelliteCount: Math.min(current.satelliteCount, 10),
    reticleCount: Math.min(current.reticleCount, 2),
    dpr: 1,
  }
}
