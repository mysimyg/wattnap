/**
 * Generates the PWA icons as PNGs with no image dependencies -- just node's
 * zlib and a hand-rolled PNG encoder. Deterministic: same bytes every run.
 *
 * Mark: a charge bolt with a crescent moon. Charging plus sleeping, which is
 * the whole app.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BG = [13, 17, 23]
const BOLT = [255, 209, 102]
const MOON = [138, 180, 248]

const BOLT_POLY = [
  [0.545, 0.055], [0.255, 0.565], [0.435, 0.565],
  [0.375, 0.945], [0.685, 0.435], [0.505, 0.435], [0.60, 0.055],
]

function pointInPoly(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy)

/** Colour at a normalized point, or null for background. */
function sample(x, y, { maskable }) {
  const inset = maskable ? 0.18 : 0.06
  const s = 1 - inset * 2
  const u = (x - inset) / s
  const v = (y - inset) / s
  if (u < 0 || u > 1 || v < 0 || v > 1) return null
  // crescent: one disc minus an offset disc
  if (dist(u, v, 0.76, 0.25) < 0.17 && dist(u, v, 0.70, 0.19) > 0.16) return MOON
  if (pointInPoly(u, v, BOLT_POLY)) return BOLT
  return null
}

function render(size, { maskable = false } = {}) {
  const SS = 3 // supersampling for antialiasing
  const px = Buffer.alloc(size * size * 4)
  const radius = maskable ? 0 : size * 0.22
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size
          const c = sample(x, y, { maskable }) ?? BG
          r += c[0]; g += c[1]; b += c[2]; n++
        }
      }
      // rounded-corner alpha for the non-maskable icon
      let a = 255
      if (radius > 0) {
        const cx = Math.min(pxi, size - 1 - pxi)
        const cy = Math.min(py, size - 1 - py)
        if (cx < radius && cy < radius) {
          const d = Math.hypot(radius - cx, radius - cy)
          a = d > radius ? 0 : d > radius - 1 ? Math.round(255 * (radius - d)) : 255
        }
      }
      const o = (py * size + pxi) * 4
      px[o] = Math.round(r / n)
      px[o + 1] = Math.round(g / n)
      px[o + 2] = Math.round(b / n)
      px[o + 3] = a
    }
  }
  return encodePng(px, size, size)
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), render(size))
}
writeFileSync(join(outDir, 'icon-512-maskable.png'), render(512, { maskable: true }))
console.log('icons written to public/icons/')
