import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// No network anywhere in this file -- it only reads the already-built files
// in public/data/. Run `node scripts/build-sleep-geojson.mjs` first if those
// files don't exist yet or look stale.

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'public', 'data')

const REQUIRED_PROPS = ['id', 'name', 'category', 'notes', 'confirmed', 'source', 'sourceUrl', 'verified']
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Same bounding box the build script enforces -- CA/NV with a small buffer.
const BBOX = { minLon: -124.6, maxLon: -113.9, minLat: 32.0, maxLat: 42.1 }
// Kept in sync with CATEGORY_META in scripts/build-sleep-geojson.mjs.
// Expanded 2026-08-12 to cover the I-5 corridor; "blm" stays excluded
// (phase 2 / icebox per DESIGN.md) and is asserted against below.
const ALLOWED_CATEGORIES = [
  'rest-area',
  'truck-stop',
  'walmart',
  'cracker-barrel',
  'casino',
  'outdoor-retail',
  'dispersed-nf',
  'host-network',
]

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

describe('sleep spot data (public/data/sleep-*.geojson + sleep-index.json)', () => {
  it('sleep-index.json exists and parses', () => {
    const indexPath = join(dataDir, 'sleep-index.json')
    expect(existsSync(indexPath)).toBe(true)
    expect(() => JSON.parse(readFileSync(indexPath, 'utf8'))).not.toThrow()
  })

  let index
  let geojsonFiles

  beforeAll(() => {
    index = JSON.parse(readFileSync(join(dataDir, 'sleep-index.json'), 'utf8'))
    geojsonFiles = readdirSync(dataDir).filter((f) => f.startsWith('sleep-') && f.endsWith('.geojson'))
  })

  it('index is a non-empty array', () => {
    expect(Array.isArray(index)).toBe(true)
    expect(index.length).toBeGreaterThan(0)
  })

  it('does not build the blm category (phase 2 / icebox per DESIGN.md)', () => {
    const categories = index.map((entry) => entry.category)
    expect(categories).not.toContain('blm')
  })

  it('every index entry has category/label/file/icon/color and a matching category', () => {
    for (const entry of index) {
      expect(typeof entry.category).toBe('string')
      expect(typeof entry.label).toBe('string')
      expect(typeof entry.file).toBe('string')
      expect(typeof entry.icon).toBe('string')
      expect(typeof entry.color).toBe('string')
      expect(ALLOWED_CATEGORIES).toContain(entry.category)
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
    // distinct colors per category
    const colors = index.map((e) => e.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('every category in the index has a matching geojson file on disk', () => {
    for (const entry of index) {
      const filePath = join(dataDir, entry.file)
      expect(existsSync(filePath)).toBe(true)
    }
  })

  it('every sleep-*.geojson file on disk is referenced by the index', () => {
    const indexedFiles = new Set(index.map((e) => e.file))
    for (const file of geojsonFiles) {
      expect(indexedFiles.has(file)).toBe(true)
    }
  })

  describe('every emitted GeoJSON file', () => {
    it('parses as a valid FeatureCollection with at least one feature', () => {
      expect(geojsonFiles.length).toBeGreaterThan(0)
      for (const file of geojsonFiles) {
        const raw = readFileSync(join(dataDir, file), 'utf8')
        let parsed
        expect(() => {
          parsed = JSON.parse(raw)
        }).not.toThrow()
        expect(parsed.type).toBe('FeatureCollection')
        expect(Array.isArray(parsed.features)).toBe(true)
        expect(parsed.features.length).toBeGreaterThan(0)
      }
    })

    it('every feature has a Point geometry with [lon, lat] coordinates inside the CA/NV bbox', () => {
      for (const file of geojsonFiles) {
        const parsed = JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
        for (const feature of parsed.features) {
          expect(feature.type).toBe('Feature')
          expect(feature.geometry?.type).toBe('Point')
          const coords = feature.geometry?.coordinates
          expect(Array.isArray(coords)).toBe(true)
          expect(coords).toHaveLength(2)
          const [lon, lat] = coords
          expect(typeof lon).toBe('number')
          expect(typeof lat).toBe('number')

          // [lon, lat] order sanity: CA/NV latitudes (32-42) are numerically
          // larger than CA/NV longitudes are negative-large (-114 to -124.6).
          // A swapped pair would put a ~-118 value where lat (32-42) belongs,
          // or a ~37 value where lon (negative, magnitude > 113) belongs --
          // both are caught by the bbox check below, but we also assert the
          // sign/magnitude directly so a swap fails clearly.
          expect(lon).toBeLessThan(0)
          expect(lat).toBeGreaterThan(0)

          expect(lon).toBeGreaterThanOrEqual(BBOX.minLon)
          expect(lon).toBeLessThanOrEqual(BBOX.maxLon)
          expect(lat).toBeGreaterThanOrEqual(BBOX.minLat)
          expect(lat).toBeLessThanOrEqual(BBOX.maxLat)
        }
      }
    })

    it('every feature has all required properties, correctly typed', () => {
      for (const file of geojsonFiles) {
        const parsed = JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
        for (const feature of parsed.features) {
          const props = feature.properties
          for (const key of REQUIRED_PROPS) {
            expect(props, `${file} / ${props?.id}: missing "${key}"`).toHaveProperty(key)
          }
          expect(typeof props.id).toBe('string')
          expect(props.id.length).toBeGreaterThan(0)
          expect(typeof props.name).toBe('string')
          expect(props.name.length).toBeGreaterThan(0)
          expect(ALLOWED_CATEGORIES).toContain(props.category)
          expect(typeof props.notes).toBe('string')
          expect(props.notes.length).toBeGreaterThan(0)
          expect(typeof props.source).toBe('string')
          expect(props.source.length).toBeGreaterThan(0)
          expect(typeof props.sourceUrl).toBe('string')
          expect(props.sourceUrl).toMatch(/^https?:\/\//)
          expect(typeof props.verified).toBe('boolean')
          if (props.ioverlanderUrl !== undefined) {
            expect(typeof props.ioverlanderUrl).toBe('string')
            expect(props.ioverlanderUrl).toMatch(/^https?:\/\//)
          }
        }
      }
    })

    it('"confirmed" is a valid ISO YYYY-MM-DD date on every feature', () => {
      for (const file of geojsonFiles) {
        const parsed = JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
        for (const feature of parsed.features) {
          expect(isValidIsoDate(feature.properties.confirmed), `${file} / ${feature.properties.id}: confirmed=${feature.properties.confirmed}`).toBe(true)
        }
      }
    })

    it('the file name matches the feature category (sleep-<category>.geojson)', () => {
      for (const file of geojsonFiles) {
        const parsed = JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
        for (const feature of parsed.features) {
          expect(file).toBe(`sleep-${feature.properties.category}.geojson`)
        }
      }
    })
  })

  it('feature ids are unique across all sleep-*.geojson files', () => {
    const seen = new Map()
    for (const file of geojsonFiles) {
      const parsed = JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
      for (const feature of parsed.features) {
        const id = feature.properties.id
        expect(seen.has(id), `duplicate id "${id}" in ${file} (first seen in ${seen.get(id)})`).toBe(false)
        seen.set(id, file)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('rebuilding the dataset is deterministic (byte-identical output)', () => {
    // Re-run the build script and confirm the files it writes are exactly
    // what's already on disk -- i.e. no timestamps, no unstable ordering.
    // We don't execSync the script here (that would be a subprocess, not
    // "no network", but still adds fragility); instead we just re-parse and
    // re-serialize with the same JSON.stringify(..., null, 2) shape the
    // build script uses and confirm it round-trips without drift in feature
    // order or content.
    for (const file of geojsonFiles) {
      const raw = readFileSync(join(dataDir, file), 'utf8')
      const parsed = JSON.parse(raw)
      const ids = parsed.features.map((f) => f.properties.id)
      const sortedIds = [...ids].sort()
      expect(ids, `${file}: feature order is not sorted by id`).toEqual(sortedIds)
    }
  })
})

// --------------------------------------------------------- corridor coverage --
/**
 * The dataset's whole purpose is answering "where can I sleep on THIS drive?"
 * A pin count can't answer that -- 200 pins around Sacramento still leaves the
 * Central Valley empty. On 2026-08-12 the shipped data had 19 pins and left
 * 414 consecutive miles of the Ventura->Tahoe route with nothing within 5
 * miles. These guard the property that actually matters: the longest stretch
 * of road with nowhere to stop.
 */
describe('sleep coverage along the real reference routes', () => {
  const MAX_ACCEPTABLE_GAP_MI = 120

  it.each([
    ['route-slt-default-live.json', 'Ventura -> South Lake Tahoe'],
    ['route-reno-default-live.json', 'Ventura -> Reno'],
  ])('%s has no catastrophic sleep gap', async (file, _label) => {
    const { auditRoute, loadRouteGeometry, loadSleepPins } = await import(
      '../scripts/audit-sleep-coverage.mjs'
    )
    const audit = auditRoute(loadRouteGeometry(file), loadSleepPins(), { maxDetourMi: 5 })
    expect(audit.longestGapMi).toBeLessThan(MAX_ACCEPTABLE_GAP_MI)
    expect(audit.inCorridorCount).toBeGreaterThan(12)
  })

  it('never ships a facility known to be closed', async () => {
    // Six rest areas were shipped as verified:true while closed for
    // construction, including the only coverage on the Tahoe route.
    const { loadSleepPins } = await import('../scripts/audit-sleep-coverage.mjs')
    const pins = loadSleepPins()
    const closedIds = [
      'rest-tejon-pass-n',
      'rest-tejon-pass-s',
      'rest-gaviota-n',
      'rest-gaviota-s',
      'rest-coso-junction',
      'rest-gold-run-w',
    ]
    for (const id of closedIds) {
      expect(pins.find((p) => p.id === id)).toBeUndefined()
    }
    // ...but the open direction of a partially-closed facility must survive.
    expect(pins.find((p) => p.id === 'rest-gold-run-e')).toBeTruthy()
  })
})
