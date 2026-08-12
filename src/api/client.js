/**
 * Client for the wattnap-api Cloudflare Worker. See DESIGN.md §3.
 *
 * Never talks to NREL/ORS/OCM directly — the Worker holds every secret.
 * If VITE_API_BASE is unset, every call rejects with a NOT_CONFIGURED
 * ApiError so the UI can render a calm explanation instead of crashing.
 */

const RAW_BASE = import.meta.env.VITE_API_BASE || ''
// Strip a trailing slash so `${API_BASE}/v1/route` never double-slashes.
const API_BASE = RAW_BASE.replace(/\/+$/, '')

export const isConfigured = Boolean(API_BASE)

export class ApiError extends Error {
  constructor(code, message, retryAfter) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryAfter = retryAfter
  }
}

const DEFAULT_TIMEOUT_MS = 15000

// One in-flight controller per logical request key. Re-submitting the same
// logical request (e.g. typing a new "from" query, or hitting "plan trip"
// again) aborts whatever was already in flight for that key.
const inflight = new Map()

async function request(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, key } = {}) {
  if (!isConfigured) {
    throw new ApiError(
      'NOT_CONFIGURED',
      'The Cloudflare Worker URL (VITE_API_BASE) has not been set yet.'
    )
  }

  if (key && inflight.has(key)) {
    inflight.get(key).abort()
  }
  const controller = new AbortController()
  if (key) inflight.set(key, controller)

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    let json = null
    try {
      json = await res.json()
    } catch {
      throw new ApiError('UPSTREAM_ERROR', 'The server returned an unreadable response.')
    }

    if (!res.ok || (json && json.error)) {
      const e = (json && json.error) || {}
      throw new ApiError(
        e.code || 'UPSTREAM_ERROR',
        e.message || `Request failed (HTTP ${res.status}).`,
        e.retryAfter
      )
    }

    return json
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (err && err.name === 'AbortError') {
      if (timedOut) {
        throw new ApiError('TIMEOUT', 'The request timed out. Check your connection and try again.')
      }
      // Superseded by a newer request for the same key — not a user-facing error.
      throw new ApiError('ABORTED', 'Request superseded.')
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError('OFFLINE', 'You appear to be offline.')
    }
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server.')
  } finally {
    clearTimeout(timer)
    if (key && inflight.get(key) === controller) inflight.delete(key)
  }
}

export function geocode(q, { limit = 5, field = 'default' } = {}) {
  const params = new URLSearchParams({ q, limit: String(limit) })
  return request(`/v1/geocode?${params.toString()}`, { key: `geocode:${field}` }).then((r) => r.results || [])
}

/** from/to are [lon, lat] pairs. */
export function fetchRoute(from, to) {
  return request('/v1/route', {
    method: 'POST',
    body: { from, to },
    key: 'route',
    timeoutMs: 25000,
  })
}

/**
 * routeCoords: simplified 2D polyline, <= 300 points, per DESIGN.md §4.1.
 * connectors: array of connector type strings.
 */
export function fetchStations({ route: routeCoords, distanceMi, minKw, connectors }) {
  return request('/v1/stations', {
    method: 'POST',
    body: { route: routeCoords, distance_mi: distanceMi, min_kw: minKw, connectors },
    key: 'stations',
    timeoutMs: 25000,
  })
}
