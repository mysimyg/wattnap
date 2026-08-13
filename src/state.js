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
import { planTrip, annotateStations } from './planner/index.js'

// The planner ships in this build; it is imported directly. It is a pure
// module (no network, no DOM, no clock) so importing it here is free.
// ---------------------------------------------------------------------------
const planTripSafe = (args) => planTrip(args)
const annotateStationsSafe = (stations, routeGeometry) =>
  annotateStations(stations, routeGeometry)

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const DEFAULT_CORRIDOR_MI = 5
const DEFAULT_MIN_KW = 250
const DEFAULT_CONNECTORS = ['TESLA', 'J1772COMBO'] // DESIGN.md §9 Q3 fallback

function initialState() {
  const vehicleId = vehiclesData.default
  const strategyPreset = strategiesData.strategies.find((s) => s.id === strategiesData.defaultStrategy) || strategiesData.strategies[0]
  return {
    // trip endpoints
    from: null, // { label, lat, lon }
    to: null,

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
    const resp = await api.fetchRoute([s.from.lon, s.from.lat], [s.to.lon, s.to.lat])
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
  try {
    const plan = await planTripSafe({
      route: s.route,
      stations: candidates,
      vehicle,
      strategy: s.strategy,
      startSoc: s.startSoc,
    })
    // Guard against a stale response landing after a newer trip was planned.
    if (getState().route !== s.route) return
    setState({ plan, planStatus: 'success' })
  } catch (err) {
    setState({ planStatus: 'error', plan: null })
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

export function visibleSleepFeatures(s = getState()) {
  return s.sleepFeatures.filter((f) => s.sleepCategoryEnabled[f.properties.category] !== false)
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
    route: s.route,
    stations: s.stations,
    stationsMeta: s.stationsMeta,
    corridorMi: s.corridorMi,
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
    route: trip.route,
    stations: trip.stations || [],
    stationsMeta: trip.stationsMeta || null,
    corridorMi: trip.corridorMi ?? DEFAULT_CORRIDOR_MI,
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
