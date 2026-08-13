#!/usr/bin/env node
/**
 * Measures sleep-spot coverage against the REAL captured route geometry.
 *
 * The question this answers is the one a driver actually asks: "how far can I
 * go on this road before there is somewhere to sleep?" A raw pin count can't
 * answer that -- 200 pins clustered around Sacramento still leaves the
 * Central Valley empty. So the headline metric here is the LONGEST GAP: the
 * longest continuous stretch of the route with no sleep spot within the
 * detour threshold.
 *
 * Usage:
 *   node scripts/audit-sleep-coverage.mjs            # human-readable
 *   node scripts/audit-sleep-coverage.mjs --json     # machine-readable
 *   node scripts/audit-sleep-coverage.mjs --detour 10
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { annotateStations } from '../src/planner/geo.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'public', 'data')
const fixturesDir = join(here, '..', 'test', 'fixtures')

const MILES = 1609.344

export const ROUTES = [
  { key: 'slt', label: 'Ventura -> South Lake Tahoe (I-5 + US-50)', file: 'route-slt-default-live.json' },
  { key: 'reno', label: 'Ventura -> Reno (I-5 + I-80)', file: 'route-reno-default-live.json' },
]

/** Every sleep pin currently published, flattened across category files. */
export function loadSleepPins(dir = dataDir) {
  const indexPath = join(dir, 'sleep-index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const pins = []
  for (const cat of index) {
    const fc = JSON.parse(readFileSync(join(dir, cat.file), 'utf8'))
    for (const f of fc.features) {
      pins.push({
        id: f.properties.id,
        name: f.properties.name,
        category: cat.category,
        verified: f.properties.verified === true,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      })
    }
  }
  return pins
}

export function loadRouteGeometry(file, dir = fixturesDir) {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')).route.geometry
}

/**
 * Gaps along one route. A "gap" is a stretch with no pin within maxDetourMi.
 * The leading gap (start -> first pin) and trailing gap (last pin -> end) are
 * included: arriving at a destination with nowhere to stop is a real problem,
 * not an edge case.
 */
export function auditRoute(routeGeometry, pins, { maxDetourMi = 5 } = {}) {
  const annotated = annotateStations(
    pins.map((p) => ({ ...p, maxKw: 1 })),
    routeGeometry
  )
  const inCorridor = annotated
    .filter((p) => p.detour_m / MILES <= maxDetourMi)
    .sort((a, b) => a.distanceAlongRoute_m - b.distanceAlongRoute_m)

  let totalM = 0
  for (let i = 1; i < routeGeometry.length; i++) {
    const a = routeGeometry[i - 1]
    const b = routeGeometry[i]
    const R = 6371008.8
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(b[1] - a[1])
    const dLon = toRad(b[0] - a[0])
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
    totalM += 2 * R * Math.asin(Math.sqrt(h))
  }

  const gaps = []
  let cursor = 0
  for (const p of inCorridor) {
    const at = p.distanceAlongRoute_m
    if (at - cursor > 0) {
      gaps.push({ fromMi: cursor / MILES, toMi: at / MILES, lengthMi: (at - cursor) / MILES })
    }
    cursor = Math.max(cursor, at)
  }
  if (totalM - cursor > 0) {
    gaps.push({ fromMi: cursor / MILES, toMi: totalM / MILES, lengthMi: (totalM - cursor) / MILES })
  }
  gaps.sort((a, b) => b.lengthMi - a.lengthMi)

  return {
    totalMi: totalM / MILES,
    inCorridorCount: inCorridor.length,
    verifiedCount: inCorridor.filter((p) => p.verified).length,
    byCategory: inCorridor.reduce((acc, p) => {
      acc[p.category] = (acc[p.category] || 0) + 1
      return acc
    }, {}),
    longestGapMi: gaps.length ? gaps[0].lengthMi : 0,
    gaps,
    pins: inCorridor.map((p) => ({
      alongMi: p.distanceAlongRoute_m / MILES,
      detourMi: p.detour_m / MILES,
      name: p.name,
      category: p.category,
      verified: p.verified,
    })),
  }
}

function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const detourIdx = args.indexOf('--detour')
  const maxDetourMi = detourIdx >= 0 ? Number(args[detourIdx + 1]) : 5

  const pins = loadSleepPins()
  const out = {}
  for (const route of ROUTES) {
    out[route.key] = {
      label: route.label,
      ...auditRoute(loadRouteGeometry(route.file), pins, { maxDetourMi }),
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ maxDetourMi, totalPins: pins.length, routes: out }, null, 2))
    return
  }

  console.log(`\nSleep coverage audit — corridor width ${maxDetourMi} mi, ${pins.length} pins total\n`)
  for (const route of ROUTES) {
    const r = out[route.key]
    console.log(`${r.label}  (${r.totalMi.toFixed(0)} mi)`)
    console.log(
      `  in corridor: ${r.inCorridorCount} (${r.verifiedCount} verified)  ` +
        `| longest gap: ${r.longestGapMi.toFixed(0)} mi`
    )
    console.log(`  by category: ${JSON.stringify(r.byCategory)}`)
    console.log('  worst gaps:')
    for (const g of r.gaps.slice(0, 3)) {
      console.log(`    ${g.lengthMi.toFixed(0).padStart(4)} mi  (mile ${g.fromMi.toFixed(0)} -> ${g.toMi.toFixed(0)})`)
    }
    console.log('')
  }
}

// pathToFileURL, not a template string: this repo's path contains a space,
// which import.meta.url percent-encodes and a raw argv[1] does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
