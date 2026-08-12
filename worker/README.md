# wattnap-api (Cloudflare Worker)

Proxies the frontend to ORS, NREL AFDC, and OpenChargeMap, and is the only
place API keys live. See `DESIGN.md` §2–§4 for the full contract; this file
is just the "how do I run it" doc.

## Run locally

```
npm run worker:dev
```

This runs `wrangler dev --config worker/wrangler.toml`. It works with **zero
keys configured** — every upstream has a documented fallback (see below) —
but each fallback is explicitly dev-only, so don't ship on it.

### `.dev.vars`

Create `worker/.dev.vars` (already gitignored) for local secrets. Wrangler
loads it automatically in dev mode. Placeholder format — **never commit real
values**:

```
NREL_API_KEY=your-nrel-key-here
ORS_API_KEY=your-ors-key-here
OCM_API_KEY=your-ocm-key-here
```

Omit any line to exercise that key's fallback path locally.

## What degrades when a key is missing

| Key | Missing behavior |
|---|---|
| `ORS_API_KEY` | Routing falls back to the public OSRM demo server (`router.project-osrm.org`). **Dev-only**: OSRM's usage policy caps this at ~1 req/sec with no uptime guarantee and access can be withdrawn at any time (DESIGN.md §2.3). OSRM also returns 2D geometry only — the response sets the third (elevation) coordinate to `null` and `"elevationAvailable": false` so the frontend/planner can tell. Geocoding falls back to Nominatim (`nominatim.openstreetmap.org`), which is also **dev-only**: it has its own strict usage policy (no heavy use, a descriptive `User-Agent` required — set in `upstream.js`) and is not suitable for a live PWA. |
| `NREL_API_KEY` | Station lookups use NREL's public `DEMO_KEY` instead. The response includes `"usingDemoKey": true`. `DEMO_KEY` has a **very low hourly request limit** (far below the 1,000/hr a real key gets) — expect to get rate-limited quickly in shared/dev use. |
| `OCM_API_KEY` | The OpenChargeMap fallback (used when AFDC errors or returns zero stations) is simply skipped; the Worker returns whatever AFDC found (possibly empty) with `"source": "afdc"`. |

`GET /health` reports which of the three keys are configured, as booleans
only (`{ors, nrel, ocm}`) — it never echoes the key values themselves.

## Create the KV cache namespace

The KV cache (binding name `CACHE`) is **optional** — the Worker runs with
caching disabled if it isn't bound, which is the default state before you've
run `wrangler login`. To enable it:

```
npx wrangler login
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create CACHE --preview
```

Copy the two `id` values printed into the commented-out `[[kv_namespaces]]`
block in `worker/wrangler.toml` and uncomment it.

Without KV: no response caching, and the per-IP soft rate limit (120
req/hr/IP, backstop against burning the NREL hourly budget) is also skipped
silently — neither throws.

## Set secrets (production)

```
npx wrangler secret put NREL_API_KEY --config worker/wrangler.toml
npx wrangler secret put ORS_API_KEY  --config worker/wrangler.toml
npx wrangler secret put OCM_API_KEY  --config worker/wrangler.toml
```

Each prompts for the value interactively and stores it only in Cloudflare —
never in the repo, never in `wrangler.toml`.

## Deploy

```
npm run worker:deploy
```

Runs `wrangler deploy --config worker/wrangler.toml`. Requires
`wrangler login` first. Update `ALLOWED_ORIGINS` in `wrangler.toml` (or via
`wrangler secret`/dashboard vars) once the real GitHub Pages origin is known
— see DESIGN.md Q8.

## Origin allowlist

`ALLOWED_ORIGINS` (comma-separated) in `[vars]` in `wrangler.toml`, default:

```
https://mysimyg.github.io,http://localhost:5173,http://localhost:4173
```

Enforced on both the `OPTIONS` preflight and the real request. A request
with no `Origin` header (curl, health checks) is only allowed for `/health`.

## Tests

```
npx vitest run test/worker.test.js
```

Pure-function unit tests only — no network, no live KV. Covers station
normalization (reported/inferred/unknown kW, both AFDC and OCM shapes), the
origin allowlist decision function, cache-key canonicalization, and the WKT
builder (including the 300-point rejection).
