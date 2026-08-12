# wattnap

EV road trip planner for people who would rather charge shallow and often than
sit through the taper. Enter a trip, see DC fast chargers from every network
along the corridor, vetted overnight sleep spots, and a charging plan built
around **a charge window you define** instead of a charge-to-80 default.

Static site on GitHub Pages, installable as a PWA, with a Cloudflare Worker
holding every API key.

**Live:** https://mysimyg.github.io/wattnap/

---

## What makes the planner different

Most planners assume you charge to 80%. The top of the pack is the slowest part
of the curve, so that assumption quietly costs you time. wattnap plans around
four numbers you control:

| Setting | Default | What it does |
|---|---|---|
| `arriveSocTarget` | 12% | Plan stops so you arrive at roughly this SOC |
| `departSocTarget` | 50% | Leave the charger here |
| `taperCutoffKw` | 100 kW | Also leave when the modelled rate drops below this |
| `reserveFloor` | 8% | Hard minimum. No plan ever dips below it |

Departure is whichever of the SOC target or the taper cutoff comes first.

Three things keep this honest rather than a fantasy:

- **Per-stop overhead** (default 5 min for exit, plug, re-enter) is charged on
  every stop, so shallow hopping does not look free. On the Ventura → Tahoe
  corridor the 12→50 and 10→80 strategies land within a few minutes of each
  other — which is exactly the sort of thing you want to *see* rather than
  guess at.
- **Elevation-aware consumption.** Ascent and descent are accumulated
  separately, never netted, because regen only returns about 70% of a climb.
  Ventura → South Lake Tahoe is ~3,400 m of cumulative ascent, worth about a
  quarter of the pack. A flat Wh/mile model puts you on the shoulder at Echo
  Summit.
- **Corridor override.** If the next charger is out of reach within your
  window, the plan raises the departure SOC at the current stop and tells you
  why, with the actual gap distance and climb.

Stations whose power output is not reported by the data source are marked
`unknown` and left out of the plan rather than guessed at.

---

## Setup from zero

### 1. Clone and install

```bash
git clone https://github.com/mysimyg/wattnap.git && cd wattnap && npm install
```

### 2. Get API keys

| Key | Where | Free tier | Needed for |
|---|---|---|---|
| `NREL_API_KEY` | https://developer.nlr.gov/signup/ | 1,000 req/hour | Charger data (AFDC) |
| `ORS_API_KEY` | https://openrouteservice.org/dev/#/signup | see their plans page | Routing **with elevation**, geocoding |
| `OCM_API_KEY` | https://openchargemap.org/site/developerinfo | generous | Optional charger fallback |

**Note the domain: `developer.nlr.gov`.** The old `developer.nrel.gov` was
retired on 2026-05-29.

**What degrades without keys** — the app still runs:

| Missing | Behaviour |
|---|---|
| `NREL_API_KEY` | Falls back to AFDC `DEMO_KEY` (very low hourly limit). Response sets `usingDemoKey: true` |
| `ORS_API_KEY` | Routing falls back to the public OSRM demo server, which returns **no elevation** — the planner says so and its climbs are unmodelled. Geocoding falls back to Nominatim. Both are dev-only per their usage policies |
| `OCM_API_KEY` | No OpenChargeMap fallback; AFDC only |

### 3. Local development

Keys never enter the repo. For local Worker runs, create `worker/.dev.vars`
(gitignored):

```
NREL_API_KEY=your-key-here
ORS_API_KEY=your-key-here
OCM_API_KEY=your-key-here
```

Then, in two terminals:

```bash
npm run worker:dev
```

```bash
VITE_API_BASE=http://localhost:8787 npm run dev
```

### 4. Deploy the Worker

```bash
npx wrangler login
```

Create the KV namespace for caching and paste the returned id into
`worker/wrangler.toml`:

```bash
npx wrangler kv namespace create CACHE
```

Set the secrets (these live in Cloudflare, never in git):

```bash
npx wrangler secret put NREL_API_KEY --config worker/wrangler.toml
```

Repeat for `ORS_API_KEY` and `OCM_API_KEY`, then deploy:

```bash
npm run worker:deploy
```

Set `ALLOWED_ORIGINS` in `worker/wrangler.toml` to your Pages origin. Any other
origin gets a 403 — that allowlist plus the KV cache is what keeps a free-tier
key from being drained by someone else.

### 5. Deploy the site

Pages builds from GitHub Actions on every push to `main`. One repo variable
tells the frontend where the Worker is — set it once:

```bash
gh variable set VITE_API_BASE --body "https://wattnap-api.<your-subdomain>.workers.dev"
```

Without it the app loads and explains that the API is not configured, rather
than failing silently.

---

## Commands

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

```bash
node scripts/make-fixtures.mjs
```

```bash
node scripts/build-sleep-geojson.mjs
```

```bash
node scripts/make-icons.mjs
```

---

## Architecture

```
GitHub Pages (static)  ->  Cloudflare Worker  ->  ORS / NREL AFDC / OpenChargeMap
   MapLibre + Preact        allowlist + KV cache      all keys live here
   planner (pure JS)
```

The planner is a pure function — no network, no DOM, no clock — so the whole
charging model is tested headlessly against frozen fixtures. See
`test/planner.test.js`, which cross-checks the closed-form charge-time integral
against brute-force numeric integration and fuzzes 120 strategy combinations
asserting the reserve floor is never breached.

Full architecture, API contracts, data schemas, and open questions:
[DESIGN.md](DESIGN.md). Project state and decision log: [STATE.md](STATE.md).

## Data and attribution

- Charger data: [NREL Alternative Fuel Stations](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/),
  [OpenChargeMap](https://openchargemap.org)
- Routing and geocoding: [OpenRouteService / HeiGIT](https://openrouteservice.org),
  [OSRM](https://project-osrm.org) (dev only)
- Basemap: © [CARTO](https://carto.com/attributions), © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- Sleep spots: hand-curated, each pin carries its source and the date it was
  confirmed. **Overnight parking rules change and are widely misreported.
  Check the date on a pin, and confirm before you rely on it.**

## Caveats worth knowing

- The charge curve shipped for the Model Y is an **estimate**, flagged as such
  in the UI. Validate it against a real session before trusting a tight plan.
- Charger power comes from a public dataset with real gaps. `kwSource` on every
  station tells you whether the figure was reported, inferred, or unknown.
- The planner models consumption, not weather, wind, tyre pressure, or a heavy
  right foot. Treat the reserve floor as a reserve.
