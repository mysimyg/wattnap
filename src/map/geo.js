/**
 * Geometry helpers used by the UI layer. NOT the trip planner — see the
 * note at the bottom of state.js about the temporary annotateStations
 * fallback. This file only ever does map/geo bookkeeping (route
 * simplification for the /v1/stations request, distance-along-route for
 * sorting/display), never SOC or charge-time math.
 */
// Named imports from the individual turf packages (not the `@turf/turf`
// meta-package) so the bundler can tree-shake the modules we don't use.
import { lineString, point } from '@turf/helpers'
import { simplify } from '@turf/simplify'
import { buffer } from '@turf/buffer'
import { nearestPointOnLine } from '@turf/nearest-point-on-line'

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

/**
 * Fallback for planner.annotateStations() when src/planner/index.js has not
 * landed yet. Adds distanceAlongRoute_m (for sort order) and detour_m (out
 * off the highway and back, approximated as 2x the perpendicular distance).
 * This is a stopgap for UI ordering only — the real annotateStations is
 * owned by the lead and this function should be deleted once it exists.
 */
export function fallbackAnnotateStations(stations, routeGeometry) {
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) return stations
  const line = lineString(routeGeometry.map(([lon, lat]) => [lon, lat]))
  return stations.map((s) => {
    try {
      const snapped = nearestPointOnLine(line, point([s.lon, s.lat]), {
        units: 'kilometers',
      })
      const alongKm = snapped.properties.location ?? 0
      const detourKm = snapped.properties.dist ?? 0
      return {
        ...s,
        distanceAlongRoute_m: Math.round(alongKm * 1000),
        detour_m: Math.round(detourKm * 2 * 1000),
      }
    } catch {
      return { ...s, distanceAlongRoute_m: null, detour_m: null }
    }
  })
}
