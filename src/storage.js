/**
 * localStorage persistence, versioned so a future schema change can migrate
 * or discard cleanly instead of crashing on old data.
 *
 * Keys: wattnap.v1.trips, wattnap.v1.strategies, wattnap.v1.lastTripId
 */

const PREFIX = 'wattnap.v1.'
const KEYS = {
  trips: PREFIX + 'trips',
  strategies: PREFIX + 'strategies',
  lastTripId: PREFIX + 'lastTripId',
}

function safeGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallback
    const parsed = JSON.parse(raw)
    return parsed
  } catch (err) {
    // Malformed JSON or localStorage unavailable (private mode, disabled) —
    // never let a storage read crash the app.
    console.warn(`wattnap: could not read ${key} from localStorage`, err)
    return fallback
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (err) {
    // Quota exceeded, private-mode write blocked, or serialization failure.
    console.warn(`wattnap: could not write ${key} to localStorage`, err)
    return false
  }
}

export function loadTrips() {
  const v = safeGet(KEYS.trips, [])
  return Array.isArray(v) ? v : []
}

export function saveTrip(trip) {
  const trips = loadTrips().filter((t) => t.id !== trip.id)
  trips.unshift(trip)
  const trimmed = trips.slice(0, 20)
  const ok = safeSet(KEYS.trips, trimmed)
  if (ok) safeSet(KEYS.lastTripId, trip.id)
  return ok
}

export function deleteTrip(id) {
  const trips = loadTrips().filter((t) => t.id !== id)
  return safeSet(KEYS.trips, trips)
}

export function loadLastTrip() {
  const lastId = safeGet(KEYS.lastTripId, null)
  if (!lastId) return null
  const trips = loadTrips()
  return trips.find((t) => t.id === lastId) || trips[0] || null
}

export function loadStrategies(defaults) {
  const v = safeGet(KEYS.strategies, null)
  if (!Array.isArray(v) || v.length === 0) return defaults
  return v
}

export function saveStrategies(strategies) {
  return safeSet(KEYS.strategies, strategies)
}
