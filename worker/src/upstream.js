// worker/src/upstream.js
//
// All outbound calls to third-party APIs (ORS, OSRM, Nominatim, NREL AFDC,
// OpenChargeMap) live here. Callers in index.js never see upstream URLs,
// keys, or raw error bodies — everything funnels through UpstreamError,
// which carries only a safe code/message/retryAfter. Upstream details go to
// console.error for server-side debugging only.

import { normalizeAfdcStation, normalizeOcmStation } from './normalize.js';

export class UpstreamError extends Error {
  constructor(code, message, { status = 502, retryAfter } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code; // 'BAD_REQUEST' | 'UPSTREAM_ERROR' | 'RATE_LIMITED'
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const NOMINATIM_USER_AGENT = 'wattnap-worker/0.1 (dev-only fallback; https://github.com/mysimyg/wattnap)';
const MAX_ROUTE_POINTS = 300;

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export async function geocode(env, q, limit) {
  if (!q || typeof q !== 'string' || !q.trim()) {
    throw new UpstreamError('BAD_REQUEST', 'q is required', { status: 400 });
  }
  const n = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 20) : 5;

  if (env && env.ORS_API_KEY) {
    return geocodeOrs(env, q, n);
  }
  console.error('geocode: ORS_API_KEY not set, falling back to Nominatim (dev-only, see README)');
  return geocodeNominatim(q, n);
}

async function geocodeOrs(env, q, limit) {
  const url = new URL('https://api.openrouteservice.org/geocode/search');
  url.searchParams.set('api_key', env.ORS_API_KEY);
  url.searchParams.set('text', q);
  url.searchParams.set('size', String(limit));

  let res;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    console.error('ORS geocode network error', err);
    throw new UpstreamError('UPSTREAM_ERROR', 'geocoding upstream unreachable');
  }
  if (!res.ok) {
    await logUpstreamError('ORS geocode', res);
    throw mapUpstreamStatus(res);
  }
  const body = await res.json();
  const features = Array.isArray(body.features) ? body.features : [];
  return {
    results: features.map((f) => ({
      label: f.properties && f.properties.label,
      lat: f.geometry && f.geometry.coordinates && f.geometry.coordinates[1],
      lon: f.geometry && f.geometry.coordinates && f.geometry.coordinates[0],
    })),
  };
}

async function geocodeNominatim(q, limit) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));

  let res;
  try {
    res = await fetch(url.toString(), { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
  } catch (err) {
    console.error('Nominatim geocode network error', err);
    throw new UpstreamError('UPSTREAM_ERROR', 'geocoding upstream unreachable');
  }
  if (!res.ok) {
    await logUpstreamError('Nominatim geocode', res);
    throw mapUpstreamStatus(res);
  }
  const body = await res.json();
  const list = Array.isArray(body) ? body : [];
  return {
    results: list.map((r) => ({
      label: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    })),
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export async function route(env, from, to) {
  if (!isCoordPair(from) || !isCoordPair(to)) {
    throw new UpstreamError('BAD_REQUEST', 'from and to must be [lon, lat] pairs', { status: 400 });
  }
  if (env && env.ORS_API_KEY) {
    return routeOrs(env, from, to);
  }
  console.error(
    'route: ORS_API_KEY not set, falling back to the public OSRM demo server. ' +
      'This path is DEV-ONLY per DESIGN.md §2.3 (1 req/sec, no uptime guarantee, no elevation).'
  );
  return routeOsrm(from, to);
}

function isCoordPair(c) {
  return Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number';
}

/**
 * radiuses: how far ORS will search from each coordinate for a routable
 * road. The default (~350m) is too tight for a Pelias administrative-
 * centroid result -- e.g. "Ventura, CA, USA" resolves to a point on the
 * beach, and ORS's default radius can't reach the nearest real street from
 * there. 5km comfortably covers a city/county centroid landing in a park,
 * beach, or waterway near a town, without being so large it could snap a
 * genuinely bad coordinate to an unrelated road far away.
 */
export function buildOrsDirectionsBody(from, to) {
  return { coordinates: [from, to], elevation: true, radiuses: [5000, 5000] }
}

async function routeOrs(env, from, to) {
  let res;
  try {
    res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: env.ORS_API_KEY,
      },
      body: JSON.stringify(buildOrsDirectionsBody(from, to)),
    });
  } catch (err) {
    console.error('ORS directions network error', err);
    throw new UpstreamError('UPSTREAM_ERROR', 'routing upstream unreachable');
  }
  if (!res.ok) {
    await logUpstreamError('ORS directions', res);
    throw mapUpstreamStatus(res);
  }
  const body = await res.json();
  const feature = body.features && body.features[0];
  if (!feature) {
    console.error('ORS directions: no route feature in response', JSON.stringify(body).slice(0, 500));
    throw new UpstreamError('UPSTREAM_ERROR', 'no route found');
  }
  const summary = (feature.properties && feature.properties.summary) || {};
  return {
    distance_m: summary.distance ?? null,
    duration_s: summary.duration ?? null,
    geometry: feature.geometry.coordinates,
    bbox: feature.bbox || body.bbox || null,
    elevationAvailable: true,
  };
}

async function routeOsrm(from, to) {
  const coordStr = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error('OSRM directions network error', err);
    throw new UpstreamError('UPSTREAM_ERROR', 'routing upstream unreachable');
  }
  if (!res.ok) {
    await logUpstreamError('OSRM directions', res);
    throw mapUpstreamStatus(res);
  }
  const body = await res.json();
  const r = body.routes && body.routes[0];
  if (!r) {
    console.error('OSRM directions: no route in response', JSON.stringify(body).slice(0, 500));
    throw new UpstreamError('UPSTREAM_ERROR', 'no route found');
  }
  const coords = r.geometry.coordinates; // [[lon,lat], ...] — 2D only
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    distance_m: r.distance ?? null,
    duration_s: r.duration ?? null,
    geometry: coords.map((c) => [c[0], c[1], null]),
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    elevationAvailable: false,
  };
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

/**
 * Build the WKT LINESTRING AFDC expects from a simplified route polyline.
 * Pure + exported so the 300-point cap and shape validation is unit-testable
 * without network.
 * @param {Array<[number, number]>} routePoints
 */
export function buildWkt(routePoints) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    throw new UpstreamError('BAD_REQUEST', 'route must contain at least 2 points', { status: 400 });
  }
  if (routePoints.length > MAX_ROUTE_POINTS) {
    throw new UpstreamError(
      'BAD_REQUEST',
      `route exceeds ${MAX_ROUTE_POINTS} points (got ${routePoints.length}); simplify client-side first`,
      { status: 400 }
    );
  }
  const parts = routePoints.map((p, i) => {
    if (!isCoordPair(p)) {
      throw new UpstreamError('BAD_REQUEST', `route[${i}] must be a [lon, lat] pair`, { status: 400 });
    }
    return `${p[0]} ${p[1]}`;
  });
  return `LINESTRING(${parts.join(', ')})`;
}

function boundingBoxOf(routePoints, distanceMi) {
  const lons = routePoints.map((p) => p[0]);
  const lats = routePoints.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  // Rough padding in degrees; good enough for a fallback corridor query.
  const padLat = distanceMi / 69;
  const midLat = (minLat + maxLat) / 2;
  const padLon = distanceMi / (69 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLon: minLon - padLon,
    maxLon: maxLon + padLon,
  };
}

/**
 * Fetch DC fast stations along a route corridor. Always fetches *unfiltered*
 * by power (ev_charging_level=dc_fast only) — the caller filters by kW
 * locally after normalization, per DESIGN.md Q2 (ev_power_kw_min silently
 * drops stations with missing power data upstream).
 *
 * Falls back AFDC -> OCM when AFDC errors or returns an empty list, and OCM
 * is configured.
 */
export async function fetchStations(env, { route: routePoints, distance_mi, connectors }) {
  const wkt = buildWkt(routePoints);
  const distanceMi = typeof distance_mi === 'number' && distance_mi > 0 ? Math.min(distance_mi, 100) : 5;
  const connectorList = Array.isArray(connectors) && connectors.length ? connectors : ['TESLA', 'J1772COMBO'];

  const usingDemoKey = !(env && env.NREL_API_KEY);
  const nrelKey = (env && env.NREL_API_KEY) || 'DEMO_KEY';
  if (usingDemoKey) {
    console.error('stations: NREL_API_KEY not set, using DEMO_KEY (very low hourly quota, see README)');
  }

  let afdcStations = null;
  let afdcError = null;
  try {
    afdcStations = await fetchAfdc(nrelKey, wkt, distanceMi, connectorList);
  } catch (err) {
    afdcError = err;
    console.error('AFDC stations fetch failed', err);
  }

  if (afdcStations && afdcStations.length > 0) {
    return { stations: afdcStations, source: 'afdc', usingDemoKey };
  }

  // AFDC errored, or came back empty — fall back to OCM if configured.
  if (env && env.OCM_API_KEY) {
    try {
      const ocmStations = await fetchOcm(env.OCM_API_KEY, routePoints, distanceMi);
      return { stations: ocmStations, source: 'ocm', usingDemoKey };
    } catch (err) {
      console.error('OCM fallback fetch failed', err);
      if (afdcError) throw afdcError; // prefer the original AFDC error
      throw err;
    }
  }

  if (afdcError) throw afdcError;
  // AFDC succeeded but genuinely found nothing, and no OCM key configured.
  return { stations: [], source: 'afdc', usingDemoKey };
}

async function fetchAfdc(apiKey, wkt, distanceMi, connectorList) {
  // NOTE: developer.nlr.gov (like the api.data.gov infra it sits behind)
  // requires `api_key` as a query parameter — passing it in the
  // form-encoded body (as DESIGN.md's phrasing suggests) gets rejected with
  // API_KEY_MISSING. Verified against live traffic. Everything else about
  // the request (a real route LINESTRING blows past URL length) still goes
  // in the POST body.
  const url = `https://developer.nlr.gov/api/alt-fuel-stations/v1/nearby-route.json?api_key=${encodeURIComponent(
    apiKey
  )}`;
  const params = new URLSearchParams({
    route: wkt,
    distance: String(distanceMi),
    fuel_type: 'ELEC',
    ev_charging_level: 'dc_fast',
    ev_connector_type: connectorList.join(','),
    status: 'E',
    access: 'public',
    limit: 'all',
  });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch (err) {
    console.error('AFDC network error', err);
    throw new UpstreamError('UPSTREAM_ERROR', 'stations upstream unreachable');
  }
  if (!res.ok) {
    await logUpstreamError('AFDC nearby-route', res);
    throw mapUpstreamStatus(res);
  }
  const body = await res.json();
  const list = Array.isArray(body.fuel_stations) ? body.fuel_stations : [];
  return list.map(normalizeAfdcStation);
}

async function fetchOcm(apiKey, routePoints, distanceMi) {
  const bbox = boundingBoxOf(routePoints, distanceMi);
  const url = new URL('https://api.openchargemap.io/v3/poi');
  url.searchParams.set('output', 'json');
  url.searchParams.set('countrycode', 'US');
  url.searchParams.set('maxresults', '500');
  url.searchParams.set('compact', 'true');
  url.searchParams.set('verbose', 'false');
  url.searchParams.set(
    'boundingbox',
    `(${bbox.maxLat},${bbox.minLon}),(${bbox.minLat},${bbox.maxLon})`
  );

  let res;
  try {
    res = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } });
  } catch (err) {
    console.error('OCM network error', err);
    throw new UpstreamError('UPSTREAM_ERROR', 'stations fallback upstream unreachable');
  }
  if (!res.ok) {
    await logUpstreamError('OCM poi', res);
    throw mapUpstreamStatus(res);
  }
  const body = await res.json();
  const list = Array.isArray(body) ? body : [];
  return list.map(normalizeOcmStation);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function logUpstreamError(label, res) {
  let text = '';
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  console.error(`${label} failed: status=${res.status}`, text.slice(0, 1000));
}

function mapUpstreamStatus(res) {
  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
    return new UpstreamError('RATE_LIMITED', 'upstream rate limit exceeded', {
      status: 429,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : 60,
    });
  }
  if (res.status === 400) {
    return new UpstreamError('BAD_REQUEST', 'upstream rejected the request', { status: 400 });
  }
  return new UpstreamError('UPSTREAM_ERROR', 'upstream request failed', { status: 502 });
}
