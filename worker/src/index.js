// worker/src/index.js
//
// wattnap-api Cloudflare Worker: origin allowlist, KV cache, and the three
// upstream-proxying routes. See DESIGN.md §3 for the contract this file
// implements. Keep secrets and upstream error detail out of every response
// body — see upstream.js's UpstreamError for the sanctioned error shape.

import { UpstreamError, geocode, route as fetchRoute, fetchStations } from './upstream.js';
import { filterStationsByKw } from './normalize.js';
import {
  CACHE_TTL_SECONDS,
  computeCacheKey,
  getCached,
  setCached,
  checkRateLimit,
} from './cache.js';

export const VERSION = '0.1.0';

export const DEFAULT_ALLOWED_ORIGINS =
  'https://mysimyg.github.io,http://localhost:5173,http://localhost:4173';

/** Parse env.ALLOWED_ORIGINS (comma-separated) into a trimmed string[]. */
export function parseAllowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || DEFAULT_ALLOWED_ORIGINS;
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pure decision function: is this Origin header value allowed? */
export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function errorResponse(code, message, status, extra = {}) {
  const body = { error: { code, message } };
  if (extra.retryAfter) body.error.retryAfter = extra.retryAfter;
  const headers = {
    'Content-Type': 'application/json',
    'X-Wattnap-Cache': 'miss',
    ...(extra.headers || {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function jsonResponse(data, { status = 200, cacheStatus = 'miss', headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Wattnap-Cache': cacheStatus,
      ...headers,
    },
  });
}

/** Map any thrown error to the standard envelope, without leaking detail. */
function errorFromException(err, headers) {
  if (err instanceof UpstreamError) {
    return errorResponse(err.code, err.message, err.status, { retryAfter: err.retryAfter, headers });
  }
  console.error('unexpected worker error', err);
  return errorResponse('UPSTREAM_ERROR', 'internal error', 500, { headers });
}

async function withCache(env, cacheKind, cacheKey, headers, compute) {
  const cached = await getCached(env, cacheKey);
  if (cached) {
    return jsonResponse(cached, { cacheStatus: 'hit', headers });
  }
  const data = await compute();
  await setCached(env, cacheKey, data, CACHE_TTL_SECONDS[cacheKind]);
  return jsonResponse(data, { cacheStatus: 'miss', headers });
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

async function handleHealth(env, headers) {
  return jsonResponse(
    {
      ok: true,
      version: VERSION,
      upstreams: {
        ors: Boolean(env && env.ORS_API_KEY),
        nrel: Boolean(env && env.NREL_API_KEY),
        ocm: Boolean(env && env.OCM_API_KEY),
      },
    },
    { cacheStatus: 'miss', headers }
  );
}

async function handleGeocode(request, env, headers) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw != null ? parseInt(limitRaw, 10) : 5;

  if (!q || !q.trim()) {
    return errorResponse('BAD_REQUEST', 'query parameter "q" is required', 400, { headers });
  }

  const cacheKey = await computeCacheKey('GET', '/v1/geocode', { q, limit });
  return withCache(env, 'geocode', cacheKey, headers, () => geocode(env, q, limit));
}

async function handleRoute(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('BAD_REQUEST', 'request body must be JSON', 400, { headers });
  }
  const { from, to } = body || {};
  if (
    !Array.isArray(from) ||
    from.length < 2 ||
    !Array.isArray(to) ||
    to.length < 2 ||
    typeof from[0] !== 'number' ||
    typeof from[1] !== 'number' ||
    typeof to[0] !== 'number' ||
    typeof to[1] !== 'number'
  ) {
    return errorResponse('BAD_REQUEST', '"from" and "to" must each be [lon, lat] number pairs', 400, {
      headers,
    });
  }

  // Cache key = rounded coords (5 decimals), per DESIGN.md §3, so nearby
  // requests for "the same" trip share a cache entry.
  const roundedPayload = {
    from: [round5(from[0]), round5(from[1])],
    to: [round5(to[0]), round5(to[1])],
  };
  const cacheKey = await computeCacheKey('POST', '/v1/route', roundedPayload);
  return withCache(env, 'route', cacheKey, headers, () => fetchRoute(env, from, to));
}

async function handleStations(request, env, headers) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('BAD_REQUEST', 'request body must be JSON', 400, { headers });
  }
  const {
    route: routePoints,
    distance_mi,
    min_kw,
    connectors,
    include_unknown_kw,
  } = body || {};

  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    return errorResponse('BAD_REQUEST', '"route" must be an array of at least 2 [lon, lat] points', 400, {
      headers,
    });
  }
  if (routePoints.length > 300) {
    return errorResponse(
      'BAD_REQUEST',
      `"route" exceeds 300 points (got ${routePoints.length}); simplify client-side first`,
      400,
      { headers }
    );
  }

  const includeUnknown = include_unknown_kw !== false;
  // Cache key = SHA-256 of the full canonicalized request body, per DESIGN.md §3.
  const cacheKey = await computeCacheKey('POST', '/v1/stations', {
    route: routePoints,
    distance_mi: distance_mi ?? null,
    min_kw: min_kw ?? null,
    connectors: connectors ?? null,
    include_unknown_kw: includeUnknown,
  });

  return withCache(env, 'stations', cacheKey, headers, async () => {
    const { stations, source, usingDemoKey } = await fetchStations(env, {
      route: routePoints,
      distance_mi,
      connectors,
    });
    const { stations: filtered, counts } = filterStationsByKw(stations, {
      min_kw,
      include_unknown_kw: includeUnknown,
    });
    return {
      stations: filtered,
      source,
      truncated: false,
      counts,
      ...(usingDemoKey ? { usingDemoKey: true } : {}),
    };
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const origin = request.headers.get('Origin');
  const allowedOrigins = parseAllowedOrigins(env);
  const originIsAllowed = isOriginAllowed(origin, allowedOrigins);

  // CORS preflight — allowed only for an allowed origin.
  if (request.method === 'OPTIONS') {
    if (originIsAllowed) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    return errorResponse('NOT_ALLOWED', 'origin not allowed', 403);
  }

  // Enforce the allowlist on the real request too. A missing Origin header
  // (curl, uptime checks) is permitted only for /health.
  if (origin) {
    if (!originIsAllowed) {
      return errorResponse('NOT_ALLOWED', 'origin not allowed', 403);
    }
  } else if (pathname !== '/health') {
    return errorResponse('NOT_ALLOWED', 'origin header required', 403);
  }

  const headers = origin && originIsAllowed ? corsHeaders(origin) : {};

  // Soft per-IP throttle, backstop only — skips silently without KV.
  const ip = request.headers.get('CF-Connecting-IP');
  const rate = await checkRateLimit(env, ip);
  if (rate.limited) {
    return errorResponse('RATE_LIMITED', 'too many requests, slow down', 429, {
      retryAfter: rate.retryAfter,
      headers,
    });
  }

  try {
    if (request.method === 'GET' && pathname === '/health') {
      return await handleHealth(env, headers);
    }
    if (request.method === 'GET' && pathname === '/v1/geocode') {
      return await handleGeocode(request, env, headers);
    }
    if (request.method === 'POST' && pathname === '/v1/route') {
      return await handleRoute(request, env, headers);
    }
    if (request.method === 'POST' && pathname === '/v1/stations') {
      return await handleStations(request, env, headers);
    }
    return errorResponse('BAD_REQUEST', 'not found', 404, { headers });
  } catch (err) {
    return errorFromException(err, headers);
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('unhandled worker error', err);
      return errorResponse('UPSTREAM_ERROR', 'internal error', 500);
    }
  },
};
