// worker/src/cache.js
//
// KV-backed response cache + soft per-IP rate limit. Both are OPTIONAL:
// env.CACHE may be undefined (no `wrangler kv namespace create` has been run
// yet / no `wrangler login`), and every function here degrades to a no-op
// rather than throwing when that's the case.

export const CACHE_TTL_SECONDS = {
  geocode: 30 * 24 * 3600,
  route: 7 * 24 * 3600,
  stations: 24 * 3600,
};

export const RATE_LIMIT_PER_HOUR = 120;

/**
 * Recursively sort object keys so JSON.stringify is independent of key
 * insertion order. Arrays keep their order (order is meaningful there).
 */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeysDeep(value[k]);
        return acc;
      }, {});
  }
  return value;
}

/** Canonical JSON string: sorted keys, stable regardless of input key order. */
export function canonicalizeJson(value) {
  return JSON.stringify(sortKeysDeep(value === undefined ? null : value));
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the cache key: SHA-256 hex of `method + path + canonicalized JSON
 * payload`. `payload` is whatever the route considers "the request" — the
 * parsed body for POSTs, or a plain object of query params for GETs.
 */
export async function computeCacheKey(method, path, payload) {
  const canonical = canonicalizeJson(payload);
  return sha256Hex(`${String(method).toUpperCase()}:${path}:${canonical}`);
}

/** Returns the parsed cached value, or null on miss / no KV binding / error. */
export async function getCached(env, key) {
  if (!env || !env.CACHE) return null;
  try {
    const raw = await env.CACHE.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('cache read failed', err);
    return null;
  }
}

/** Writes value to KV with the given TTL. No-op (and never throws) without KV. */
export async function setCached(env, key, value, ttlSeconds) {
  if (!env || !env.CACHE) return;
  try {
    await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch (err) {
    console.error('cache write failed', err);
  }
}

function currentHourBucket(now = Date.now()) {
  return Math.floor(now / 3600000);
}

function secondsUntilNextHour(now = Date.now()) {
  const next = (currentHourBucket(now) + 1) * 3600000;
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/**
 * Rolling hourly per-IP counter, KV-backed, soft backstop only.
 * Returns { limited: false } when there's no KV binding or no IP — this must
 * never block traffic just because KV isn't provisioned yet.
 */
export async function checkRateLimit(env, ip, limit = RATE_LIMIT_PER_HOUR) {
  if (!env || !env.CACHE || !ip) return { limited: false };
  const key = `ratelimit:${ip}:${currentHourBucket()}`;
  try {
    const raw = await env.CACHE.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= limit) {
      return { limited: true, retryAfter: secondsUntilNextHour() };
    }
    // TTL of 3600s bounds the key's lifetime; bucket key itself already
    // rotates hourly so this simply avoids orphaned keys lingering in KV.
    await env.CACHE.put(key, String(count + 1), { expirationTtl: 3600 });
    return { limited: false };
  } catch (err) {
    console.error('rate limit check failed', err);
    return { limited: false };
  }
}
