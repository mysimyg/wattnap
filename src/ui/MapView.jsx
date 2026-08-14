import { useEffect, useRef, useState } from 'preact/hooks'
import { createMapController } from '../map/index.js'
import {
  useWattnap,
  filteredStations,
  visibleSleepFeatures,
  selectStationPin,
  selectSleepPin,
  closeDetailCard,
  computeWaypoints,
} from '../state.js'
import { DetailCard } from './DetailCard.jsx'
import { WaypointEditor } from './TripForm.jsx'

function fmtMin(mins) {
  if (mins == null || !isFinite(mins)) return '—'
  const m = Math.round(mins)
  const h = Math.floor(m / 60)
  const rem = m % 60
  return h > 0 ? `${h}h ${String(rem).padStart(2, '0')}m` : `${rem}m`
}

/**
 * wattnap-spec.md §8: "On the full-screen map the trip bar stays. It is a
 * 52px translucent bar pinned to the top showing the waypoint dots and the
 * route summary; tapping it opens the same editor as a sheet, so
 * destinations are editable without leaving full-screen." Resolves §9
 * item 4: full-screen previously hid .wn-side outright (D-038), which hid
 * the trip form along with everything else it hides on purpose.
 */
function TripBar({ s, onOpen }) {
  const waypoints = computeWaypoints(s)
  return (
    <button type="button" class="wn-tripbar" onClick={onOpen}>
      <div class="wn-tripbar__spine" aria-hidden="true">
        {waypoints.map((_, i) => (
          <span key={i} class="wn-tripbar__dot" />
        ))}
      </div>
      <span class="wn-tripbar__route">{waypoints.map((wp) => wp.label).join(' → ')}</span>
      {s.route ? (
        <span class="wn-tripbar__summary">
          {fmtMin(s.route.duration_s / 60)} · {Math.round(s.route.distance_m / 1609.344)} mi
        </span>
      ) : null}
    </button>
  )
}

export function MapView({ expanded = false, onToggleExpand }) {
  const s = useWattnap()
  const containerRef = useRef(null)
  const controllerRef = useRef(null)
  const [tripBarSheetOpen, setTripBarSheetOpen] = useState(false)

  useEffect(() => {
    const controller = createMapController(containerRef.current, {
      onStationClick: selectStationPin,
      onSleepClick: selectSleepPin,
    })
    controllerRef.current = controller
    return () => controller.destroy()
  }, [])

  useEffect(() => {
    if (!controllerRef.current) return
    // Call this even when s.route is falsy (e.g. a failed re-plan) --
    // setRoute(null) clears the line. Skipping the call here was the bug:
    // the PREVIOUS route stayed drawn while the panels correctly showed an
    // error.
    controllerRef.current.setRoute(s.route?.geometry, s.route?.bbox)
  }, [s.route])

  useEffect(() => {
    if (!controllerRef.current) return
    controllerRef.current.setCorridor(s.corridorPolygon)
  }, [s.corridorPolygon])

  useEffect(() => {
    if (!controllerRef.current) return
    // s.from/s.to, not computeWaypoints(s) -- "destination" is the trip's
    // actual endpoint regardless of round trip, which loops back to start
    // afterward rather than changing what the destination is.
    controllerRef.current.setEndpoints(s.from, s.to)
  }, [s.from, s.to])

  useEffect(() => {
    if (!controllerRef.current) return
    const selectedId = s.selectedPin && s.selectedPin.kind === 'station' ? s.selectedPin.data.id : null
    controllerRef.current.setStations(filteredStations(s), selectedId)
  }, [s.stations, s.minKw, s.networkEnabled, s.selectedPin])

  useEffect(() => {
    if (!controllerRef.current) return
    const categoryById = {}
    s.sleepCategories.forEach((c) => {
      categoryById[c.category] = c
    })
    const selectedId = s.selectedPin && s.selectedPin.kind === 'sleep' ? s.selectedPin.data.id : null
    controllerRef.current.setSleepFeatures(visibleSleepFeatures(s), categoryById, selectedId)
    // visibleSleepFeatures(s) also reads s.route and s.sleepDetourMi (route-
    // proximity filtering, added alongside the detour stepper) -- without
    // them here, moving the stepper or re-planning a route updated the
    // sleep LIST but left the MAP showing the previous, stale pin set.
  }, [s.sleepFeatures, s.sleepCategoryEnabled, s.sleepCategories, s.selectedPin, s.route, s.sleepDetourMi])

  return (
    <div class="wn-map-wrap">
      <div class="wn-map" ref={containerRef} />
      {expanded && s.from ? <TripBar s={s} onOpen={() => setTripBarSheetOpen(true)} /> : null}
      {tripBarSheetOpen ? (
        <div class="wn-modal-backdrop" onClick={() => setTripBarSheetOpen(false)}>
          <div class="wn-drawer" onClick={(e) => e.stopPropagation()}>
            <div class="wn-modal__head">
              <h2>Edit trip</h2>
              <button type="button" class="wn-icon-btn" aria-label="Close" onClick={() => setTripBarSheetOpen(false)}>
                ×
              </button>
            </div>
            <WaypointEditor />
          </div>
        </div>
      ) : null}
      {onToggleExpand ? (
        <button
          type="button"
          class="wn-map-expand"
          onClick={onToggleExpand}
          aria-pressed={expanded}
          title={expanded ? 'Exit full-screen map' : 'Expand map'}
          aria-label={expanded ? 'Exit full-screen map' : 'Expand map'}
        >
          {expanded ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 3v6H3M15 21v-6h6M3 15h6v6M21 9h-6V3"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 10V4h6M20 14v6h-6M20 10V4h-6M4 14v6h6"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          )}
        </button>
      ) : null}
      {s.selectedPin ? (
        <DetailCard pin={s.selectedPin} sleepCategories={s.sleepCategories} onClose={closeDetailCard} />
      ) : null}
    </div>
  )
}
