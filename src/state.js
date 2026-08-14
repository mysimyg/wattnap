/**
 * Central app state: a plain module-level store + localStorage persistence.
 * No state library, per DESIGN.md §1 stack table.
 *
 * Components read state via useWattnap() and call the exported action
 * functions to change it. This keeps every side effect (fetches, storage)
 * out of the UI layer.
 */
import { useEffect, useState } from 'preact/hooks'
import * as api from './api/client.js'
import * as storage from './storage.js'
import { simplifyRouteForStations, corridorBuffer } from './map/geo.js'
import vehiclesData from './data/vehicles.json'
import strategiesData from './data/strategies.json'
import { planTrip, annotateStations, haversineMeters } from './planner/index.js'
import restrictedJurisdictions from './data/restricted-jurisdictions.json'

// The planner ships in this build; it is imported directly. It is a pure
// module (no network, no DOM, no clock) so importing it here is free.
// ---------------------------------------------------------------------------
const planTripSafe = (args) => planTrip(args)
const MILES_PER_METER_DIVISOR = 1609.344

const annotateStationsSafe = (stations, routeGeometry) =>
  annotateStations(stations, routeGeometry)

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const DEFAULT_CORRIDOR_MI = 5
// Sleep spots get a wider default than chargers on purpose: the user is
// far more willing to detour for somewhere to sleep at 2am than for a
// marginally-closer charger, and said so explicitly (~10mi / ~30min was
// their own example). Chargers stay tight because a detour there costs
// real range on top of time.
const DEFAULT_SLEEP_DETOUR_MI = 20
const DEFAULT_MIN_KW = 250
const DEFAULT_CONNECTORS = ['TESLA', 'J1772COMBO'] // DESIGN.md §9 Q3 fallback

function initialState() {
  const vehicleId = vehiclesData.default
  const strategyPreset = strategiesData.strategies.find((s) => s.id === strategiesData.defaultStrategy) || strategiesData.strategies[0]
  return {
    // trip endpoints
    from: null, // { label, lat, lon }
    to: null,
    vias: [], // { label, lat, lon }[] -- intermediate stops, in order
    roundTrip: false, // appends `from` as a final leg

    // route
    route: null, // { distance_m, duration_s, geometry, bbox }
    routeStatus: 'idle', // idle | loading | error | success
    routeError: null,

    // stations
    stations: [], // annotated Station[]
    stationsMeta: null, // { source, truncated, unknownKw }
    stationsStatus: 'idle',
    stationsError: null,
    corridorMi: DEFAULT_CORRIDOR_MI,
    corridorPolygon: null,
    sleepDetourMi: DEFAULT_SLEEP_DETOUR_MI,

    // client-side filters (no refetch)
    minKw: DEFAULT_MIN_KW,
    networkEnabled: {}, // { [network]: boolean }, built from response

    // vehicle + strategy
    vehicleId,
    strategy: { ...strategyPreset },
    startSoc: strategiesData.defaultStartSoc,
    savedStrategies: storage.loadStrategies(strategiesData.strategies),

    // plan
    plan: null,
    planStatus: 'idle',

    // compare
    compareIds: [],
    compareResults: null,
    compareStatus: 'idle',

    // sleep layer
    sleepCategories: [], // from sleep-index.json
    sleepCategoryEnabled: {},
    sleepFeatures: [], // flattened GeoJSON features across all categories
    sleepStatus: 'idle',

    // ui
    activeTab: 'plan', // plan | chargers | sleep
    selectedPin: null, // { kind: 'station'|'sleep', data }
    savedTrips: storage.loadTrips(),
  }
}

let state = initialState()
const listeners = new Set()

function setState(patch) {
  state = typeof patch === 'function' ? { ...state, ...patch(state) } : { ...state, ...patch }
  listeners.forEach((l) => l(state))
}

function getState() {
  return state
}

export function useWattnap() {
  const [snapshot, setSnapshot] = useState(state)
  useEffect(() => {
    const listener = (s) => setSnapshot(s)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])
  return snapshot
}

export function getVehicles() {
  return vehiclesData.vehicles
}

export function getVehicle(id) {
  return vehiclesData.vehicles.find((v) => v.id === id) || vehiclesData.vehicles[0]
}

export function getStrategyPresets() {
  return strategiesData.strategies
}

// ---------------------------------------------------------------------------
// Actions — trip endpoints
// ---------------------------------------------------------------------------

export function setFrom(point) {
  setState({ from: point })
}

export function setTo(point) {
  setState({ to: point })
}

export function swapFromTo() {
  setState((s) => ({ from: s.to, to: s.from }))
}

// ---------------------------------------------------------------------------
// Actions — multi-stop and round trip (wattnap-spec.md §8)
//
// `from`/`to` keep meaning exactly what they always have -- origin and
// final destination -- so every existing from/to consumer (jurisdiction
// warnings, saved trips, the swap button) needs no changes. Multi-stop is
// additive: `vias` is the ordered list of stops in between, `roundTrip`
// appends `from` as a final leg. computeWaypoints() is the one place that
// turns those three fields into the ordered point list routing/planning
// actually consumes, so "what is the trip" has a single source of truth.
// ---------------------------------------------------------------------------

/** @returns {Array<{label,lat,lon}>} origin, vias in order, destination, [origin again if round trip] */
export function computeWaypoints(s = getState()) {
  const points = [s.from, ...s.vias, s.to].filter(Boolean)
  if (s.roundTrip && s.from) points.push(s.from)
  return points
}

export function addVia(point) {
  if (!point) return
  setState((s) => ({ vias: [...s.vias, point] }))
}

export function removeVia(index) {
  setState((s) => ({ vias: s.vias.filter((_, i) => i !== index) }))
}

/** Swaps via[index] with its neighbor -- the up/down move a spine row exposes. */
export function moveVia(index, dir) {
  setState((s) => {
    const next = index + dir
    if (next < 0 || next >= s.vias.length) return {}
    const vias = s.vias.slice()
    ;[vias[index], vias[next]] = [vias[next], vias[index]]
    return { vias }
  })
}

export function setRoundTrip(on) {
  setState({ roundTrip: on })
}

/**
 * DetailCard's "Add as stop" (wattnap-spec.md §7/§9-2): pins a charger into
 * the plan as a forced via. The planner itself never learns about this --
 * it's still just planTrip() called once per leg (see recomputePlan) with
 * one more leg boundary than before.
 */
export function addStationAsStop(station) {
  if (!station || typeof station.lat !== 'number' || typeof station.lon !== 'number') return
  addVia({ label: station.name || 'Charger stop', lat: station.lat, lon: station.lon })
}

// ---------------------------------------------------------------------------
// Actions — route + stations flow (phase 2 gate)
// ---------------------------------------------------------------------------

export async function planTripFlow() {
  const s = getState()
  if (!s.from || !s.to) return
  // The button's disabled state lags one render behind this call, so a
  // rapid double-tap can still land here twice before it updates -- guard
  // at the source instead. NREL/ORS quota is real and shared (DESIGN.md
  // section 10).
  if (s.routeStatus === 'loading') return
  setState({
    routeStatus: 'loading',
    routeError: null,
    stations: [],
    stationsStatus: 'idle',
    stationsMeta: null,
    plan: null,
    planStatus: 'idle',
    selectedPin: null,
  })
  try {
    const waypoints = computeWaypoints(s).map((p) => [p.lon, p.lat])
    const resp = await api.fetchRoute(waypoints)
    setState({
      route: resp,
      routeStatus: 'success',
      corridorPolygon: corridorBuffer(resp.geometry, getState().corridorMi),
    })
    await fetchStationsFlow()
  } catch (err) {
    if (err && err.code === 'ABORTED') return
    // Also clear the stale route/corridor -- otherwise a failed re-plan
    // leaves the PREVIOUS trip's line on the map while the panels correctly
    // report an error, and a driver glancing only at the map would think a
    // route still exists.
    setState({ routeStatus: 'error', routeError: err, route: null, corridorPolygon: null })
  }
}

export async function fetchStationsFlow() {
  const s = getState()
  if (!s.route) return
  setState({ stationsStatus: 'loading', stationsError: null })
  try {
    const simplified = simplifyRouteForStations(s.route.geometry)
    // Always fetch at min_kw 0 with the full connector set so the kW slider
    // and network toggles can re-filter client-side without a refetch — a
    // refetch only happens when the corridor distance changes.
    const resp = await api.fetchStations({
      route: simplified,
      distanceMi: getState().corridorMi,
      minKw: 0,
      connectors: DEFAULT_CONNECTORS,
    })
    const rawStations = resp.stations || []
    const annotated = await annotateStationsSafe(rawStations, s.route.geometry)
    const networks = [...new Set(annotated.map((st) => st.network).filter(Boolean))].sort()
    const networkEnabled = {}
    networks.forEach((n) => {
      networkEnabled[n] = true
    })
    const unknownKw =
      typeof resp?.counts?.unknownKw === 'number'
        ? resp.counts.unknownKw
        : annotated.filter((st) => st.kwSource === 'unknown').length
    setState({
      stations: annotated,
      stationsStatus: 'success',
      stationsMeta: { source: resp.source, truncated: !!resp.truncated, unknownKw },
      networkEnabled,
    })
    await recomputePlan()
  } catch (err) {
    if (err && err.code === 'ABORTED') return
    setState({ stationsStatus: 'error', stationsError: err })
  }
}

export function setCorridorMi(mi) {
  setState({ corridorMi: mi })
  const s = getState()
  if (s.route) {
    setState({ corridorPolygon: corridorBuffer(s.route.geometry, mi) })
    fetchStationsFlow()
  }
}

export function setMinKw(kw) {
  setState({ minKw: kw })
  recomputePlan()
}

export function toggleNetwork(network) {
  setState((s) => ({ networkEnabled: { ...s.networkEnabled, [network]: !s.networkEnabled[network] } }))
  recomputePlan()
}

/** Stations after the client-side kW + network filters. Never refetches. */
export function filteredStations(s = getState()) {
  return s.stations.filter((st) => {
    const kwOk = st.kwSource !== 'unknown' ? (st.maxKw ?? 0) >= s.minKw : s.minKw <= 0
    const netOk = s.networkEnabled[st.network] !== false
    return kwOk && netOk
  })
}

// ---------------------------------------------------------------------------
// Actions — vehicle / strategy / plan (phase 3 UI)
// ---------------------------------------------------------------------------

export function setVehicleId(id) {
  setState({ vehicleId: id })
  recomputePlan()
}

export function setStrategyField(field, value) {
  setState((s) => ({ strategy: { ...s.strategy, [field]: value } }))
  recomputePlan()
}

export function applyStrategyPreset(id) {
  const preset = getState().savedStrategies.find((s) => s.id === id) || strategiesData.strategies.find((s) => s.id === id)
  if (!preset) return
  setState({ strategy: { ...preset } })
  recomputePlan()
}

export function setStartSoc(v) {
  setState({ startSoc: v })
  recomputePlan()
}

/**
 * Multi-stop plan = planTrip() called once per leg, unmodified (DO NOT
 * TOUCH src/planner/*). A via is a leg boundary with a forced arrival: leg
 * i+1 starts from whatever SOC leg i's plan actually ends at, not from a
 * fresh startSoc. Stations are re-annotated per leg (distanceAlongRoute_m/
 * detour_m are only meaningful relative to the geometry they were computed
 * against) and narrowed to the current corridor width around THAT leg
 * specifically -- otherwise a station near leg 2 would appear as a
 * nominally-valid but wildly-expensive "detour" candidate while planning
 * leg 1, since annotateStations always returns a nearest point on the given
 * line rather than excluding far-away stations itself.
 */
export async function recomputePlan() {
  const s = getState()
  if (!s.route || s.stations.length === 0) {
    setState({ plan: null, planStatus: 'idle' })
    return
  }
  setState({ planStatus: 'loading' })
  const vehicle = getVehicle(s.vehicleId)
  // The UI-filtered (kW slider + network toggle) set is what's handed to the
  // planner as viable candidates — DESIGN.md §5.4 does not say explicitly
  // whether the caller or the planner applies the kW floor, so we apply it
  // here and pass the resulting candidate set straight through.
  const candidates = filteredStations(s)
  const legs =
    s.route.legs && s.route.legs.length
      ? s.route.legs
      : [{ distance_m: s.route.distance_m, duration_s: s.route.duration_s, geometry: s.route.geometry }]
  const maxDetourM = s.corridorMi * MILES_PER_METER_DIVISOR
  try {
    const legPlans = []
    let soc = s.startSoc
    for (const leg of legs) {
      const legCandidates = annotateStationsSafe(candidates, leg.geometry).filter(
        (st) => (st.detour_m ?? 0) <= maxDetourM
      )
      const legPlan = await planTripSafe({
        route: leg,
        stations: legCandidates,
        vehicle,
        strategy: s.strategy,
        startSoc: soc,
      })
      legPlans.push(legPlan)
      if (!legPlan.feasible) break // planning leg N+1 from an infeasible SOC would just compound the error
      soc = legPlan.summary.arriveSocAtDestination ?? legPlan.summary.minSocReached
    }
    // Guard against a stale response landing after a newer trip was planned.
    if (getState().route !== s.route) return
    const plan = combineLegPlans(legPlans, legs.length, computeWaypoints(s))
    setState({ plan, planStatus: 'success' })
  } catch (err) {
    setState({ planStatus: 'error', plan: null })
  }
}

/**
 * Concatenates per-leg plans into the one plan shape PlanPanel already
 * renders, inserting a via-milestone entry between legs -- "forced
 * arrival" (wattnap-spec.md §8/§9-1) should be visible in the stop list,
 * not just implicit in the next leg's startSoc. Exported for direct
 * testing: this is the one piece of phase 6's orchestration logic that
 * doesn't need a live route response to verify.
 */
export function combineLegPlans(legPlans, totalLegs, waypoints) {
  const multiLeg = totalLegs > 1
  const feasible = legPlans.length === totalLegs && legPlans.every((p) => p.feasible)
  const stops = []
  legPlans.forEach((p, i) => {
    stops.push(...p.stops)
    const isLastLeg = i === legPlans.length - 1
    if (multiLeg && !isLastLeg && p.feasible) {
      stops.push({
        isViaMilestone: true,
        viaLabel: (waypoints[i + 1] && waypoints[i + 1].label) || `Stop ${i + 2}`,
        arriveSoc: p.summary.arriveSocAtDestination,
      })
    }
  })
  const warnings = legPlans.flatMap((p, i) =>
    p.warnings.map((w) => (multiLeg ? `Leg ${i + 1} of ${totalLegs}: ${w}` : w))
  )
  const sum = (key) => legPlans.reduce((acc, p) => acc + (p.summary[key] || 0), 0)
  const first = legPlans[0]
  const last = legPlans[legPlans.length - 1]
  return {
    feasible,
    stops,
    warnings,
    summary: {
      driveMinutes: sum('driveMinutes'),
      chargeMinutes: sum('chargeMinutes'),
      overheadMinutes: sum('overheadMinutes'),
      detourMinutes: sum('detourMinutes'),
      totalMinutes: sum('totalMinutes'),
      stopCount: sum('stopCount'),
      minSocReached: legPlans.length ? Math.min(...legPlans.map((p) => p.summary.minSocReached)) : null,
      arriveSocAtDestination: last ? last.summary.arriveSocAtDestination : null,
      startSoc: first ? first.summary.startSoc : null,
      distanceMiles: sum('distanceMiles'),
      ascentM: sum('ascentM'),
      descentM: sum('descentM'),
      elevationAvailable: legPlans.length > 0 && legPlans.every((p) => p.summary.elevationAvailable),
    },
  }
}

// ---------------------------------------------------------------------------
// Actions — strategy compare
// ---------------------------------------------------------------------------

export function setCompareIds(ids) {
  setState({ compareIds: ids.slice(0, 3) })
}

export async function runCompare() {
  const s = getState()
  if (!s.route || s.stations.length === 0 || s.compareIds.length === 0) return
  setState({ compareStatus: 'loading' })
  const vehicle = getVehicle(s.vehicleId)
  const candidates = filteredStations(s)
  const all = [...strategiesData.strategies, ...s.savedStrategies]
  const results = []
  for (const id of s.compareIds) {
    const strat = all.find((x) => x.id === id) || s.savedStrategies.find((x) => x.id === id)
    if (!strat) continue
    const plan = await planTripSafe({
      route: s.route,
      stations: candidates,
      vehicle,
      strategy: strat,
      startSoc: s.startSoc,
    })
    results.push({ strategy: strat, plan })
  }
  setState({ compareResults: results, compareStatus: 'success' })
}

export function saveStrategyAsDefault(strategy) {
  const s = getState()
  const others = s.savedStrategies.filter((x) => x.id !== strategy.id)
  const next = [{ ...strategy }, ...others]
  storage.saveStrategies(next)
  setState({ savedStrategies: next })
}

// ---------------------------------------------------------------------------
// Actions — sleep layer (phase 4)
// ---------------------------------------------------------------------------

export async function loadSleepIndex() {
  setState({ sleepStatus: 'loading' })
  const base = import.meta.env.BASE_URL || '/'
  try {
    const res = await fetch(`${base}data/sleep-index.json`)
    if (!res.ok) {
      setState({ sleepCategories: [], sleepFeatures: [], sleepStatus: 'success' })
      return
    }
    const index = await res.json()
    if (!Array.isArray(index) || index.length === 0) {
      setState({ sleepCategories: [], sleepFeatures: [], sleepStatus: 'success' })
      return
    }
    const enabled = {}
    index.forEach((c) => {
      enabled[c.category] = true
    })
    setState({ sleepCategories: index, sleepCategoryEnabled: enabled })

    const allFeatures = []
    await Promise.all(
      index.map(async (cat) => {
        try {
          const r = await fetch(`${base}data/${cat.file}`)
          if (!r.ok) return
          const fc = await r.json()
          if (fc && Array.isArray(fc.features)) allFeatures.push(...fc.features)
        } catch (e) {
          console.warn(`wattnap: could not load sleep category "${cat.category}"`, e)
        }
      })
    )
    setState({ sleepFeatures: allFeatures, sleepStatus: 'success' })
  } catch (err) {
    console.warn('wattnap: sleep-index.json unavailable', err)
    setState({ sleepCategories: [], sleepFeatures: [], sleepStatus: 'success' })
  }
}

export function toggleSleepCategory(category) {
  setState((s) => ({ sleepCategoryEnabled: { ...s.sleepCategoryEnabled, [category]: !s.sleepCategoryEnabled[category] } }))
}

const SLEEP_DETOUR_STEPS = [5, 10, 15, 20, 30, 45, 60]

export function setSleepDetourMi(mi) {
  setState({ sleepDetourMi: mi })
}

/**
 * Step the detour radius by +/-1 against SLEEP_DETOUR_STEPS, reading the
 * CURRENT value from state rather than trusting a value the UI computed at
 * its last render. A component-side "next = STEPS[currentIndex + dir]"
 * reads a stale render-time snapshot, which is provably wrong for a burst of
 * clicks inside one tick (confirmed live) -- real, spaced-out taps mostly
 * hide it, but the state module owning the transition is the actual fix,
 * not a timing coincidence.
 */
export function stepSleepDetourMi(dir) {
  setState((s) => {
    const idx = Math.max(0, SLEEP_DETOUR_STEPS.indexOf(s.sleepDetourMi))
    const next = SLEEP_DETOUR_STEPS[Math.min(SLEEP_DETOUR_STEPS.length - 1, Math.max(0, idx + dir))]
    return { sleepDetourMi: next }
  })
}

/**
 * Restricted-jurisdiction advisories for the trip's endpoints.
 *
 * The dataset correctly has no sleep pins in South Lake Tahoe or Reno --
 * both ban vehicle sleeping outright, one even on private property. But
 * "no pins" and "we don't know" look identical in the UI otherwise. This
 * makes the absence explain itself, and points at the nearest real option
 * from whatever sleep spots are actually loaded, rather than a hardcoded
 * pin that could go stale.
 */
export function activeJurisdictionWarnings(s = getState()) {
  const endpoints = [
    s.from && { role: 'from', point: s.from },
    s.to && { role: 'to', point: s.to },
  ].filter(Boolean)
  if (!endpoints.length) return []

  const out = []
  for (const { role, point } of endpoints) {
    for (const jx of restrictedJurisdictions) {
      const distMi = haversineMeters([point.lon, point.lat], [jx.lon, jx.lat]) / MILES_PER_METER_DIVISOR
      if (distMi > jx.radiusMi) continue

      // Prefer a VERIFIED pin outside the restricted radius. Recommending an
      // unverified one as "the legal option" here is worse than recommending
      // nothing -- found live: Ventura->Reno pointed at a casino whose own
      // notes say sources conflict on whether it allows overnight parking at
      // all. Only fall back to an unverified pin if no verified one exists,
      // and say so explicitly rather than presenting it with equal confidence.
      let nearestVerified = null
      let nearestVerifiedDistMi = Infinity
      let nearestAny = null
      let nearestAnyDistMi = Infinity
      for (const f of s.sleepFeatures) {
        const [lon, lat] = f.geometry.coordinates
        const dMi = haversineMeters([jx.lon, jx.lat], [lon, lat]) / MILES_PER_METER_DIVISOR
        if (dMi <= jx.radiusMi) continue
        if (dMi < nearestAnyDistMi) {
          nearestAny = f
          nearestAnyDistMi = dMi
        }
        if (f.properties.verified !== false && dMi < nearestVerifiedDistMi) {
          nearestVerified = f
          nearestVerifiedDistMi = dMi
        }
      }
      const nearest = nearestVerified ?? nearestAny
      const nearestDistMi = nearestVerified ? nearestVerifiedDistMi : nearestAnyDistMi

      out.push({
        ...jx,
        role,
        endpointLabel: point.label,
        nearestOption: nearest
          ? {
              name: nearest.properties.name,
              distMi: nearestDistMi,
              unverified: !nearestVerified,
              // Carried through so the Sleep tab's "nearest option" button
              // can open the same detail card a map tap would (wattnap-
              // spec.md §7: "the nearest-legal-spot row as a filled button").
              properties: nearest.properties,
            }
          : null,
      })
    }
  }
  return out
}

const SLEEP_ANNOTATE_CACHE = new WeakMap()

/**
 * Sleep spots were never filtered by distance from the route -- every pin in
 * an enabled category showed everywhere, all the time. Harmless while the
 * whole dataset happened to sit near one corridor; wrong in general, and the
 * opposite of what the user actually wants once a trip is planned: "is there
 * somewhere to sleep on THIS drive," not "here is every pin on the west
 * coast." Reuses annotateStations, which only needs lat/lon -- a sleep spot
 * and a charger are the same shape for this purpose.
 */
export function visibleSleepFeatures(s = getState()) {
  const byCategory = s.sleepFeatures.filter(
    (f) => s.sleepCategoryEnabled[f.properties.category] !== false
  )
  if (!s.route) return byCategory

  let annotated = SLEEP_ANNOTATE_CACHE.get(s.sleepFeatures)
  if (!annotated || annotated.forRoute !== s.route) {
    const points = s.sleepFeatures.map((f) => ({
      ...f.properties,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      __feature: f,
    }))
    const withDetour = annotateStations(points, s.route.geometry)
    const detourById = new Map(withDetour.map((p) => [p.id, p.detour_m]))
    annotated = { forRoute: s.route, detourById }
    SLEEP_ANNOTATE_CACHE.set(s.sleepFeatures, annotated)
  }

  const maxDetourM = s.sleepDetourMi * MILES_PER_METER_DIVISOR
  return byCategory.filter((f) => {
    const detourM = annotated.detourById.get(f.properties.id)
    // A pin annotateStations couldn't place (e.g. off the geometry entirely)
    // is excluded rather than assumed in-range.
    return detourM != null && detourM <= maxDetourM
  })
}

// ---------------------------------------------------------------------------
// Actions — ui
// ---------------------------------------------------------------------------

export function setActiveTab(tab) {
  setState({ activeTab: tab })
}

export function selectStationPin(station) {
  setState({ selectedPin: { kind: 'station', data: station } })
}

export function selectSleepPin(props) {
  setState({ selectedPin: { kind: 'sleep', data: props } })
}

export function closeDetailCard() {
  setState({ selectedPin: null })
}

// ---------------------------------------------------------------------------
// Actions — persistence (phase 5)
// ---------------------------------------------------------------------------

export function saveCurrentTrip() {
  const s = getState()
  if (!s.from || !s.to || !s.route) return null
  const trip = {
    id: `trip-${Date.now()}`,
    savedAt: new Date().toISOString(),
    from: s.from,
    to: s.to,
    vias: s.vias,
    roundTrip: s.roundTrip,
    route: s.route,
    stations: s.stations,
    stationsMeta: s.stationsMeta,
    corridorMi: s.corridorMi,
    sleepDetourMi: s.sleepDetourMi,
    minKw: s.minKw,
    networkEnabled: s.networkEnabled,
    vehicleId: s.vehicleId,
    strategy: s.strategy,
    startSoc: s.startSoc,
  }
  const ok = storage.saveTrip(trip)
  setState({ savedTrips: storage.loadTrips() })
  return ok ? trip : null
}

export function deleteSavedTrip(id) {
  storage.deleteTrip(id)
  setState({ savedTrips: storage.loadTrips() })
}

export function loadTripIntoState(trip) {
  if (!trip) return
  setState({
    from: trip.from,
    to: trip.to,
    vias: trip.vias || [],
    roundTrip: trip.roundTrip || false,
    route: trip.route,
    stations: trip.stations || [],
    stationsMeta: trip.stationsMeta || null,
    corridorMi: trip.corridorMi ?? DEFAULT_CORRIDOR_MI,
    sleepDetourMi: trip.sleepDetourMi ?? DEFAULT_SLEEP_DETOUR_MI,
    minKw: trip.minKw ?? DEFAULT_MIN_KW,
    networkEnabled: trip.networkEnabled || {},
    vehicleId: trip.vehicleId || vehiclesData.default,
    strategy: trip.strategy || getState().strategy,
    startSoc: trip.startSoc ?? strategiesData.defaultStartSoc,
    routeStatus: 'success',
    stationsStatus: trip.stations && trip.stations.length ? 'success' : 'idle',
    corridorPolygon: trip.route ? corridorBuffer(trip.route.geometry, trip.corridorMi ?? DEFAULT_CORRIDOR_MI) : null,
  })
  recomputePlan()
}

/** Restores the last trip on load, per DESIGN.md phase 5 requirement. */
export function restoreLastTrip() {
  const trip = storage.loadLastTrip()
  if (trip) loadTripIntoState(trip)
  return trip
}
