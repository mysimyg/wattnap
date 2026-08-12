import { describe, it, expect } from 'vitest'
import worker from '../worker/src/index.js'

/**
 * Exercises the Worker's real `fetch` handler, not just its pure helpers.
 * Closes the gate 6 gap: the rate-limit state was previously unreachable in
 * tests and depends on an OPTIONAL KV binding, so nothing proved a client
 * would ever actually see a RATE_LIMITED response.
 *
 * No network: every test either short-circuits before an upstream call
 * (allowlist, rate limit, bad body) or hits /health.
 */

const ORIGIN = 'http://localhost:5173'

/** Minimal in-memory stand-in for a KV namespace binding. */
function mockKV() {
  const store = new Map()
  return {
    store,
    async get(k) {
      const v = store.get(k)
      return v === undefined ? null : v
    },
    async put(k, v) {
      store.set(k, String(v))
    },
    async delete(k) {
      store.delete(k)
    },
  }
}

const req = (path, { method = 'GET', origin = ORIGIN, ip = '203.0.113.7', body } = {}) =>
  new Request(`https://wattnap-api.example.workers.dev${path}`, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      'CF-Connecting-IP': ip,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

describe('worker fetch handler', () => {
  it('serves /health without an Origin and never leaks key values', async () => {
    const res = await worker.fetch(req('/health', { origin: null }), {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Booleans only. A health endpoint that echoes secrets is a vulnerability.
    for (const v of Object.values(body.upstreams ?? {})) {
      expect(typeof v).toBe('boolean')
    }
    expect(JSON.stringify(body)).not.toMatch(/DEMO_KEY|api_key|secret/i)
  })

  it('rejects a disallowed origin before doing any work', async () => {
    const res = await worker.fetch(req('/v1/geocode?q=ventura', { origin: 'https://evil.example' }), {})
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_ALLOWED')
  })

  it('answers the CORS preflight for an allowed origin', async () => {
    const res = await worker.fetch(req('/v1/route', { method: 'OPTIONS' }), {})
    expect([200, 204]).toContain(res.status)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('returns the standard error envelope on an unknown route', async () => {
    const res = await worker.fetch(req('/v1/nope'), {})
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
    expect(typeof body.error.code).toBe('string')
  })

  it('RATE_LIMITED is genuinely reachable once a KV binding exists', async () => {
    // The gate 6 criterion. Pre-seed the hourly bucket to its limit so the
    // very next request must be refused.
    const CACHE = mockKV()
    const env = { CACHE }
    const ip = '198.51.100.42'
    // Drive the counter through the handler itself rather than reaching into
    // the implementation, so this fails if the wiring is ever removed.
    let seen429 = null
    for (let i = 0; i < 130; i++) {
      const res = await worker.fetch(req('/v1/nope', { ip }), env)
      if (res.status === 429) {
        seen429 = res
        break
      }
    }
    expect(seen429).not.toBeNull()
    const body = await seen429.json()
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error.retryAfter).toBeGreaterThan(0)
  })

  it('without a KV binding the limiter degrades open instead of blocking traffic', async () => {
    let sawRateLimit = false
    for (let i = 0; i < 130; i++) {
      const res = await worker.fetch(req('/v1/nope', { ip: '198.51.100.99' }), {})
      if (res.status === 429) sawRateLimit = true
    }
    expect(sawRateLimit).toBe(false)
  })

  it('rejects a malformed /v1/route body without calling an upstream', async () => {
    const res = await worker.fetch(
      req('/v1/route', { method: 'POST', body: { from: 'not-a-coordinate' } }),
      {}
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
  })
})
