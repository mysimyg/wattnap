/**
 * Geometry helpers used by the UI layer. NOT the trip planner — this file
 * only ever does map/geo bookkeeping (route simplification for the
 * /v1/stations request, the corridor buffer overlay), never SOC or
 * charge-time math or station annotation. That lives in src/planner/geo.js.
 */
// Named imports from the individual turf packages (not the `@turf/turf`
// meta-package) so the bundler can tree-shake the modules we don't use.
import { lineString } from '@turf/helpers'
import { simplify } from '@turf/simplify'
import { buffer } from '@turf/buffer'

/**
 * DESIGN.md §4.1: full ORS geometry -> simplify(tolerance ~0.01deg)
 * -> cap at 300 points -> 2D [lon,lat] pairs for the /v1/stations request.
 * `geometry` is the Worker's 3D [lon,lat,ele] route geometry.
 */
export function simplifyRouteForStations(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return []
  const coords2d = geometry.map(([lon, lat]) => [lon, lat])
  const line = lineString(coords2d)
  const simplified = simplify(line, { tolerance: 0.01, highQuality: false })
  let coords = simplified.geometry.coordinates
  if (coords.length > 300) {
    const step = (coords.length - 1) / 299
    const picked = []
    for (let i = 0; i < 300; i++) picked.push(coords[Math.round(i * step)])
    coords = picked
  }
  return coords
}

/** Corridor buffer polygon for the faint map overlay, distance in miles. */
export function corridorBuffer(geometry, distanceMi) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null
  const coords2d = geometry.map(([lon, lat]) => [lon, lat])
  const line = lineString(coords2d)
  return buffer(line, distanceMi, { units: 'miles' })
}
