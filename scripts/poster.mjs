/**
 * Build-time hero poster.
 *
 * Renders the planet limb, real 110m coastlines, graticule and star field to a
 * PNG with no browser and no native image dependency. The LCP element stays
 * HTML text; this image is the frame the canvas fades in over.
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { mesh } = require('topojson-client')

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const topology = JSON.parse(
  readFileSync(resolve(root, 'node_modules/world-atlas/land-110m.json'), 'utf8'),
)
const land = mesh(topology, topology.objects.land)
const rings = land.coordinates

const OUT_W = 1600
const OUT_H = 1000
const SS = 2
const W = OUT_W * SS
const H = OUT_H * SS

const GROUND = [25, 25, 57]
const SURFACE = [27, 58, 104]
const DATA = [111, 184, 230]
const STARLIGHT = [242, 225, 153]

const buffer = new Uint8ClampedArray(W * H * 3)
buffer.fill(0)
for (let i = 0; i < W * H; i += 1) {
  buffer[i * 3] = GROUND[0]
  buffer[i * 3 + 1] = GROUND[1]
  buffer[i * 3 + 2] = GROUND[2]
}

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

function plot(x, y, color, alpha = 1) {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= W || py >= H) return
  const i = (py * W + px) * 3
  buffer[i] += (color[0] - buffer[i]) * alpha
  buffer[i + 1] += (color[1] - buffer[i + 1]) * alpha
  buffer[i + 2] += (color[2] - buffer[i + 2]) * alpha
}

function line(x0, y0, x1, y1, color, alpha, width = 1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * SS)
  if (steps <= 0) return
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps
    const x = x0 + dx * t
    const y = y0 + dy * t
    for (let ox = 0; ox < width; ox += 1) {
      for (let oy = 0; oy < width; oy += 1) plot(x + ox, y + oy, color, alpha)
    }
  }
}

/* ---------------------------------------------------------------- geometry */

const cx = W * 0.675
const cy = H * 1.62
const radius = H * 1.18
const lat0 = (9 * Math.PI) / 180
const lon0 = (-148 * Math.PI) / 180

function orthographic(lon, lat) {
  const lambda = (lon * Math.PI) / 180 - lon0
  const phi = (lat * Math.PI) / 180
  const cosc = Math.sin(lat0) * Math.sin(phi) + Math.cos(lat0) * Math.cos(phi) * Math.cos(lambda)
  if (cosc <= 0.02) return null
  const x = Math.cos(phi) * Math.sin(lambda)
  const y = Math.cos(lat0) * Math.sin(phi) - Math.sin(lat0) * Math.cos(phi) * Math.cos(lambda)
  return [cx + x * radius, cy - y * radius]
}

/* ---------------------------------------------------------------- planet */

const lightX = -0.38
const lightY = 0.52
const lightZ = 0.76

const x0 = Math.max(0, Math.floor(cx - radius))
const x1 = Math.min(W - 1, Math.ceil(cx + radius))
const y0 = Math.max(0, Math.floor(cy - radius))
const y1 = Math.min(H - 1, Math.ceil(cy + radius))

for (let y = y0; y <= y1; y += 1) {
  for (let x = x0; x <= x1; x += 1) {
    const nx = (x - cx) / radius
    const ny = (cy - y) / radius
    const d2 = nx * nx + ny * ny
    if (d2 > 1) continue
    const nz = Math.sqrt(1 - d2)
    const lit = clamp(nx * lightX + ny * lightY + nz * lightZ)
    const day = Math.pow(lit, 1.35)
    const i = (y * W + x) * 3
    buffer[i] = GROUND[0] + (SURFACE[0] - GROUND[0]) * day * 0.95
    buffer[i + 1] = GROUND[1] + (SURFACE[1] - GROUND[1]) * day * 0.95
    buffer[i + 2] = GROUND[2] + (SURFACE[2] - GROUND[2]) * day * 0.95
    const rim = Math.pow(1 - nz, 3.4)
    buffer[i] += DATA[0] * rim * 0.28
    buffer[i + 1] += DATA[1] * rim * 0.28
    buffer[i + 2] += DATA[2] * rim * 0.28
  }
}

/* -------------------------------------------------------------- graticule */

for (let lat = -75; lat <= 75; lat += 15) {
  let previous = orthographic(-180, lat)
  for (let lon = -180; lon <= 180; lon += 3) {
    const point = orthographic(lon, lat)
    if (previous && point) line(previous[0], previous[1], point[0], point[1], DATA, 0.06)
    previous = point
  }
}
for (let lon = -180; lon < 180; lon += 15) {
  let previous = orthographic(lon, -88)
  for (let lat = -88; lat <= 88; lat += 3) {
    const point = orthographic(lon, lat)
    if (previous && point) line(previous[0], previous[1], point[0], point[1], DATA, 0.06)
    previous = point
  }
}

/* -------------------------------------------------------------- coastlines */

rings.forEach((ring) => {
  let previous = null
  for (let i = 0; i < ring.length; i += 1) {
    const [lon, lat] = ring[i]
    const point = orthographic(lon, lat)
    if (previous && point) line(previous[0], previous[1], point[0], point[1], DATA, 0.5, 1)
    previous = point
  }
})

/* ------------------------------------------------------------------- stars */

let seed = 20261111
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

for (let i = 0; i < 900; i += 1) {
  const x = random() * W
  const y = random() * H * 0.82
  const nx = (x - cx) / radius
  const ny = (cy - y) / radius
  if (nx * nx + ny * ny < 1.02) continue
  const bright = random()
  const alpha = 0.18 + bright * 0.5
  plot(x, y, bright > 0.93 ? DATA : STARLIGHT, alpha)
  if (bright > 0.975) {
    plot(x + 1, y, STARLIGHT, alpha * 0.5)
    plot(x - 1, y, STARLIGHT, alpha * 0.5)
    plot(x, y + 1, STARLIGHT, alpha * 0.5)
    plot(x, y - 1, STARLIGHT, alpha * 0.5)
  }
}

/* ---------------------------------------------------------------- crescent */

const crescentX = W * 0.86
const crescentY = H * 0.15
const crescentR = 62 * SS
for (let a = 0.5; a < 2.0; a += 0.002) {
  const px = crescentX + Math.cos(a) * crescentR
  const py = crescentY + Math.sin(a) * crescentR
  plot(px, py, STARLIGHT, 0.62)
  plot(px + 1, py, STARLIGHT, 0.4)
  plot(crescentX + Math.cos(a) * (crescentR + 5), crescentY + Math.sin(a) * (crescentR + 5), STARLIGHT, 0.1)
}

/* ------------------------------------------------------------- atmosphere */

for (let a = 0; a < Math.PI * 2; a += 0.0015) {
  for (let d = 0; d < 16 * SS; d += 1) {
    const r = radius + d
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    const falloff = Math.pow(1 - d / (16 * SS), 3)
    plot(x, y, DATA, 0.1 * falloff)
  }
}

/* ------------------------------------------------------------- downsample */

const out = new Uint8ClampedArray(OUT_W * OUT_H * 3)
for (let y = 0; y < OUT_H; y += 1) {
  for (let x = 0; x < OUT_W; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 3 + c
          sum += buffer[i]
        }
      }
      out[(y * OUT_W + x) * 3 + c] = Math.round(sum / (SS * SS))
    }
  }
}

/* -------------------------------------------------------------- png writer */

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(OUT_W, 0)
ihdr.writeUInt32BE(OUT_H, 4)
ihdr[8] = 8
ihdr[9] = 2
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const stride = OUT_W * 3
const raw = Buffer.alloc((stride + 1) * OUT_H)
for (let y = 0; y < OUT_H; y += 1) {
  raw[y * (stride + 1)] = 0
  Buffer.from(out.buffer, out.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(resolve(root, 'public'), { recursive: true })
writeFileSync(resolve(root, 'public/poster.png'), png)
console.log(`poster.png ${OUT_W}×${OUT_H} · ${(png.length / 1024).toFixed(1)} kB`)

/* Open Graph card: a centre crop of the same frame, at 1200×630. */
const OG_W = 1200
const OG_H = 630
const aspect = OG_W / OG_H
let cropW = OUT_W
let cropH = Math.round(OUT_W / aspect)
if (cropH > OUT_H) {
  cropH = OUT_H
  cropW = Math.round(OUT_H * aspect)
}
const cropX = Math.round((OUT_W - cropW) / 2)
const cropY = Math.round((OUT_H - cropH) / 2)
const ogRgb = Buffer.alloc(OG_W * OG_H * 3)
for (let y = 0; y < OG_H; y += 1) {
  const sy = cropY + Math.min(cropH - 1, Math.floor(((y + 0.5) * cropH) / OG_H))
  for (let x = 0; x < OG_W; x += 1) {
    const sx = cropX + Math.min(cropW - 1, Math.floor(((x + 0.5) * cropW) / OG_W))
    const from = (sy * OUT_W + sx) * 3
    const to = (y * OG_W + x) * 3
    ogRgb[to] = out[from]
    ogRgb[to + 1] = out[from + 1]
    ogRgb[to + 2] = out[from + 2]
  }
}

const ogIhdr = Buffer.alloc(13)
ogIhdr.writeUInt32BE(OG_W, 0)
ogIhdr.writeUInt32BE(OG_H, 4)
ogIhdr[8] = 8
ogIhdr[9] = 2
const ogStride = OG_W * 3
const ogRaw = Buffer.alloc((ogStride + 1) * OG_H)
for (let y = 0; y < OG_H; y += 1) {
  ogRaw[y * (ogStride + 1)] = 0
  ogRgb.copy(ogRaw, y * (ogStride + 1) + 1, y * ogStride, (y + 1) * ogStride)
}
const ogPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ogIhdr),
  chunk('IDAT', deflateSync(ogRaw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(resolve(root, 'public/og.png'), ogPng)
console.log(`og.png ${OG_W}×${OG_H} · ${(ogPng.length / 1024).toFixed(1)} kB`)
