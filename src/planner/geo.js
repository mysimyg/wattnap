/**
 * The only part of the planner that touches turf. Kept separate so planner.js
 * stays dependency-free arithmetic and can be tested against frozen fixtures.
 */
import { lineString, point } from '@turf/helpers'
import { nearestPointOnLine } from '@turf/nearest-point-on-line'
import { length } from '@turf/length'
import { simplify } from '@turf/simplify'

/**
 * Attach distanceAlongRoute_m and detour_m to each station.
 * detour_m is the straight-line offset from the route to the station; the
 * planner charges it twice (in and out) for both energy and time.
 */
export function annotateStations(stations, routeGeometry) {
  if (!routeGeometry || routeGeometry.length < 2) return []
  const line = lineString(routeGeometry.map((p) => [p[0], p[1]]))
  return stations
    .map((s) => {
      const snapped = nearestPointOnLine(line, point([s.lon, s.lat]), { units: 'meters' })
      return {
        ...s,
        distanceAlongRoute_m: snapped.properties.location,
        detour_m: snapped.properties.dist,
      }
    })
    .sort((a, b) => a.distanceAlongRoute_m - b.distanceAlongRoute_m)
}

/**
 * Simplify a route geometry for the AFDC LINESTRING (DESIGN.md §4.1).
 * A ~1 km tolerance is far below the 5-mile corridor buffer, so it cannot move
 * a station in or out of range.
 */
export function simplifyForCorridor(routeGeometry, maxPoints = 300, tolerance = 0.01) {
  const coords = routeGeometry.map((p) => [p[0], p[1]])
  if (coords.length <= maxPoints) return coords
  let tol = tolerance
  let out = coords
  for (let i = 0; i < 8 && out.length > maxPoints; i++) {
    out = simplify(lineString(coords), { tolerance: tol, highQuality: false }).geometry
      .coordinates
    tol *= 1.8
  }
  if (out.length > maxPoints) {
    const step = Math.ceil(out.length / maxPoints)
    const decimated = out.filter((_, i) => i % step === 0)
    if (decimated[decimated.length - 1] !== out[out.length - 1]) decimated.push(out[out.length - 1])
    out = decimated
  }
  return out
}

export function routeLengthMeters(routeGeometry) {
  return length(lineString(routeGeometry.map((p) => [p[0], p[1]])), { units: 'meters' })
}
