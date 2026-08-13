# wattnap — DESIGN.md

**Status:** Phase 0 deliverable. **Awaiting human approval.** No application
code is written until this is approved.

**Mission.** Enter a trip, get a route showing DC fast chargers from all
networks (filter by kW, default 250+), vetted overnight sleep spots, and a
charging strategy planner built around a user-defined charge window instead of
charge-to-80 defaults. Static hosting on GitHub Pages, installable PWA. Owner
drives a Tesla Model Y.

---

## 1. Architecture

```
   phone browser (GitHub Pages, static)
   +-----------------------------------------+
   |  index.html  +  Vite bundle              |
   |   - MapLibre GL   (map, layers)          |
   |   - Preact        (panels, stop list)    |
   |   - turf.js       (buffer, along, dist)  |
   |   - planner.js    (pure, no I/O)         |
   |   - localStorage  (trips, strategies)    |
   |  sleep-spots/*.geojson  (in repo)        |
   +-------------------|---------------------+
                       | fetch, CORS-restricted
                       v
   +-----------------------------------------+
   |  Cloudflare Worker  "wattnap-api"        |
   |   - origin allowlist                     |
   |   - KV cache (hashed request key)        |
   |   - holds ALL secrets                    |
   +--------|--------------|-----------------+
            |              |
            v              v
     ORS (HeiGIT)     NREL AFDC (developer.nlr.gov)
     route+geocode    stations along route
     3D geometry      OpenChargeMap = fallback
```

**Why a Worker at all:** NREL and ORS both require keys, and a static site
cannot hold a key. The Worker is the only place secrets exist.

**Why the frontend never calls an upstream directly:** origin allowlist +
KV cache is the only thing standing between a shared free-tier key and a
rate-limit ban.

**Planner is pure.** `planner.js` takes `(route, stations, vehicle, strategy)`
and returns a plan. No network, no DOM, no clock. That is what makes the phase 3
test agent able to run it headlessly against fixtures.

### Stack

| Concern | Choice | Note |
|---|---|---|
| Build | Vite | nothing heavier |
| Map | MapLibre GL JS | vector tiles, free style |
| Geo math | turf.js | `buffer`, `along`, `length`, `nearestPointOnLine` |
| UI | Preact + hooks | stop list and strategy compare are stateful lists; vanilla would get worse, not simpler |
| State | plain module + localStorage | no state library |
| Basemap tiles | **OPEN Q1** | see open questions |

---

## 2. External APIs — verified 2026-08-12

### 2.1 NREL AFDC — stations (primary)

**The domain moved.** `developer.nrel.gov` was retired **2026-05-29**. The
current host is **`developer.nlr.gov`**. Get the free key there, not at the
old domain.

- Endpoint: `GET|POST https://developer.nlr.gov/api/alt-fuel-stations/v1/nearby-route.json`
- POST is required in practice — a real route LINESTRING blows past URL length.
- Rate limit: **1,000 requests/hour** per key. KV cache is what keeps us under it.

Request params we use:

| Param | Value |
|---|---|
| `route` | WKT `LINESTRING(lon lat, ...)` — simplified, see §4.1 |
| `distance` | corridor buffer in miles, 0–100, default 5 |
| `fuel_type` | `ELEC` |
| `ev_charging_level` | `dc_fast` |
| ~~`ev_power_kw_min`~~ | **Deliberately not sent** — see the note below |
| `ev_connector_type` | `TESLA,J1772COMBO` (see OPEN Q3) |
| `status` | `E` (available) |
| `access` | `public` |
| `limit` | `all` |

Response fields that matter: `ev_network`, `ev_connector_types[]`,
`ev_dc_fast_num`, `ev_level2_evse_num`, and `ev_charging_units[]`.

**Corrected 2026-08-12 against live responses** (the docs and the wire disagree;
the wire wins):

- **`api_key` goes in the query string, not the form body.** Sending it in the
  POST body returns `403 API_KEY_MISSING`.
- **`ev_charging_units[]` nests power by connector type**, not flat. The real
  shape is `unit.connectors.TESLA.power_kw`, *not* `unit.power_kw`. The
  normalizer reads the nested shape and keeps a defensive fallback for the flat
  one.
- **There is no station URL field.** `Station.url` is honestly `null` for AFDC
  rather than fabricated.

**Known data risk, and how we handle it:** `power_kw` is not populated for
every station. `ev_power_kw_min` filters server-side, which would silently drop
stations whose power is merely *unrecorded* — indistinguishable, from the
client, from stations that are genuinely slow.

So the Worker **does not send `ev_power_kw_min`**. It fetches unfiltered (still
`ev_charging_level=dc_fast`), normalizes, then filters locally, and returns
`counts: {returned, beforeKwFilter, unknownKw}` so the UI can say plainly how
many stations had no power data. `include_unknown_kw` (default `true`) controls
whether they survive the filter. See §4.2 `kwSource`. Remaining measurement
work is **OPEN Q2**.

### 2.2 OpenChargeMap — stations (fallback)

Used only when AFDC returns an error or an empty set. Different schema,
normalized to the same `Station` shape (§4.2). Requires a free key. Attribution
required in the UI footer.

### 2.3 Routing — OpenRouteService, not the OSRM public server

**Recommendation: route through ORS (HeiGIT) via the Worker.** Two reasons:

1. **OSRM demo terms do not fit.** Verified policy: reasonable non-commercial
   use only, **max 1 req/sec**, no uptime/latency/data guarantees, access
   withdrawable at any time without reason, and the service-wide limit is
   5,000 req/min shared across everyone. Fine for local dev. Not something to
   put behind a PWA install prompt.
2. **ORS returns elevation in the route geometry** (`elevation=true` → 3D
   coordinates). Phase 3 needs a per-leg elevation profile for Echo Summit and
   Donner. Getting it free with the route beats a second elevation API call.

OSRM stays wired as a **dev-only fallback** behind an env flag, so the app still
works before the ORS key exists.

- Directions: `POST /v2/directions/driving-car/geojson`, body
  `{coordinates, elevation:true, radiuses:[5000,5000]}`.
  **`radiuses` corrected 2026-08-13 (D-030):** without it, ORS's default
  point-snap search (~350m) fails on a Pelias administrative-centroid
  geocode result that lands off the road network — e.g. "Ventura, CA, USA"
  resolves to a beach point. A real user hit this live. 5km per waypoint
  fixes it without being so large it risks snapping a genuinely bad
  coordinate to an unrelated road.
- Geocoding: `GET /geocode/search` (Pelias)
- Free tier quota: **OPEN Q4** — the plans page is JS-rendered and could not be
  read programmatically. Must be read by a human at signup and recorded here
  before we tune cache TTLs.

### 2.4 Elevation

Primary: the `z` value in the ORS 3D geometry — no extra call.
Fallback if ORS is unavailable: `api.open-meteo.com/v1/elevation` (no key, free).

---

## 3. Worker API contract

Base: `https://wattnap-api.<account>.workers.dev`

All responses `application/json`. All errors:
`{ "error": { "code": string, "message": string, "retryAfter"?: number } }`
with codes `BAD_REQUEST | UPSTREAM_ERROR | RATE_LIMITED | NOT_ALLOWED`.

Every response carries `X-Wattnap-Cache: hit|miss`.

### `GET /v1/geocode?q=<string>&limit=<n>`
```jsonc
{ "results": [ { "label": "Ventura, CA, USA", "lat": 34.2746, "lon": -119.2290 } ] }
```
Cache: 30 days.

### `POST /v1/route`
```jsonc
// request
{ "from": [-119.2290, 34.2746], "to": [-119.9772, 38.9399] }
// response
{
  "distance_m": 643000,
  "duration_s": 25200,          // upstream no-stop drive time
  "geometry": [[-119.229, 34.274, 32.0], ...],   // [lon, lat, elevation_m]
  "bbox": [minLon, minLat, maxLon, maxLat]
}
```
Cache: 7 days, key = rounded coords (5 decimals).

### `POST /v1/stations`
```jsonc
// request
{
  "route": [[-119.229, 34.274], ...],   // simplified 2D polyline, <= 300 pts
  "distance_mi": 5,
  "min_kw": 250,
  "connectors": ["TESLA", "J1772COMBO"]
}
// response
{ "stations": [ /* Station[] — see §4.2 */ ], "source": "afdc" | "ocm",
  "truncated": false }
```
Cache: 24 hours, key = SHA-256 of the canonicalized request body.

### Security
- Origin allowlist: exact match on the Pages origin + `http://localhost:5173`.
  Anything else → `403 NOT_ALLOWED`. Enforced on both preflight and the request.
- Secrets via `wrangler secret put`: `NREL_API_KEY`, `ORS_API_KEY`, `OCM_API_KEY`.
- Never echo an upstream URL or key in an error body.
- Per-IP soft throttle in KV as a backstop against a single client burning the
  hourly NREL budget.

---

## 4. Data schemas

### 4.1 Route simplification

AFDC takes a WKT LINESTRING; a full ORS geometry is tens of thousands of points.
Pipeline: full geometry kept client-side for drawing and elevation →
`turf.simplify` (tolerance ~0.01°, ~1 km) → cap at 300 points → WKT. A 1 km
tolerance is far below the 5-mile corridor buffer, so it cannot move a station
in or out of range.

### 4.2 `Station` (normalized, both sources)
```jsonc
{
  "id": "afdc:12345",
  "source": "afdc",
  "name": "Tesla Supercharger - Mojave, CA",
  "network": "Tesla",
  "lat": 35.0525, "lon": -118.1745,
  "address": "1 Main St, Mojave, CA 93501",
  "access": "public",
  "status": "E",
  "connectors": ["TESLA", "J1772COMBO"],
  "maxKw": 250,
  "kwSource": "reported",      // "reported" = from ev_charging_units.power_kw
                               // "inferred"  = guessed from connector/level
                               // "unknown"   = no data; UI shows "kW unknown"
  "portCount": 12,
  "pricing": null,
  "url": "https://...",
  "distanceAlongRoute_m": 214000   // computed client-side, turf
}
```
`kwSource` is not decoration. A station whose power we inferred must never be
silently trusted by the planner as a 250 kW stop.

### 4.3 `VehicleProfile` — `src/data/vehicles.json`
```jsonc
{
  "id": "tesla-model-y-lr-2023",
  "name": "Tesla Model Y Long Range (2023)",
  "usableKwh": 75,
  "consumptionWhPerMile": 250,        // flat baseline at ~70 mph
  "regenEfficiency": 0.70,            // fraction of descent energy recovered
  "drivetrainEfficiency": 0.85,
  "massKg": 2000,
  "chargeCurve": [                    // piecewise linear SOC% -> kW at a 250kW+ post
    [0, 170], [5, 250], [20, 250], [30, 185], [40, 150],
    [50, 125], [60, 100], [70, 80], [80, 65], [90, 45], [100, 20]
  ]
}
```
Curve values are **estimates** pending validation — **OPEN Q5**.
Other cars slot in by adding an object to this file. No code change.

### 4.4 `Strategy` — user-editable, saved to localStorage
```jsonc
{
  "id": "hop-12-50",
  "name": "12→50 hop",
  "arriveSocTarget": 12,     // default 12, range 5-25
  "departSocTarget": 50,     // default 50
  "taperCutoffKw": 100,      // default 100
  "reserveFloor": 8,         // default 8, hard minimum, never violated
  "overheadMinPerStop": 5    // exit, plug, re-enter
}
```
Ships with two presets: `12→50 hop` and `10→80 classic`.

### 4.5 `Plan` — planner output
```jsonc
{
  "feasible": true,
  "stops": [
    {
      "station": { /* Station */ },
      "arriveSoc": 13.4,
      "departSoc": 50,
      "chargeMinutes": 18,
      "avgKw": 168,
      "overrideReason": null      // | "sparse-corridor" | "elevation"
    }
  ],
  "summary": {
    "driveMinutes": 420,          // no-stop baseline, the default comparison
    "chargeMinutes": 54,
    "overheadMinutes": 15,
    "totalMinutes": 489,
    "stopCount": 3,
    "minSocReached": 11.2
  },
  "warnings": [ "No charger within range between Bishop and Lee Vining..." ]
}
```
`feasible: false` when no valid plan exists — the UI says so plainly rather than
returning a plan that dips below `reserveFloor`.

### 4.6 Sleep spots — `public/data/sleep-<category>.geojson`
Standard GeoJSON `FeatureCollection`, one file per category
(`cracker-barrel`, `rest-area`, `casino`, `blm` in phase 2).
```jsonc
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-118.1745, 35.0525] },
  "properties": {
    "id": "cb-mojave-ca",
    "name": "Cracker Barrel — Barstow",
    "category": "cracker-barrel",
    "notes": "Level lot at the back, ask inside. Truck noise from I-15.",
    "confirmed": "2026-08-01",
    "source": "iOverlander",
    "ioverlanderUrl": "https://ioverlander.com/places/..."
  }
}
```
`confirmed` is a date, not a boolean — a two-year-old sleep spot is a rumor.
Curated by hand + build script; v0 covers the CA/NV corridors only.

---

## 5. The charging strategy planner (phase 3 core)

### 5.1 Leg energy, elevation-aware

For each polyline segment, using the 3D route geometry:

```
flat_kWh     = miles * consumptionWhPerMile / 1000
climb_kWh    = massKg * 9.81 * ascent_m  / 3.6e6 / drivetrainEfficiency
descent_kWh  = massKg * 9.81 * descent_m / 3.6e6 * regenEfficiency
leg_kWh      = flat_kWh + climb_kWh - descent_kWh
```

For the Model Y numbers above that is **0.0064 kWh per meter climbed** and
**0.0038 kWh recovered per meter descended**. A flat Wh/mile model would put
the driver on the shoulder at Echo Summit. This is the whole reason elevation
is in phase 3 and not the icebox.

Ascent and descent are summed **separately** across segments — net elevation
change is wrong, because you do not get the climb back at 100%.

**Measured 2026-08-13 against real captured ORS data** (not the estimate
above): Ventura → South Lake Tahoe via the real default route is **~6,300 m**
of cumulative ascent, ~53% of the pack in climb energy — roughly double the
original ~3,000 m estimate, because the real route crosses two ranges (Tejon
Pass then the Sierra via Echo Summit), not one. See §5.1.1 for how that
figure was actually derived and why it is a deliberately conservative choice,
not a discovered constant.

#### 5.1.1 Elevation smoothing is distance-based, not point-count-based (D-023)

Raw GPS/DEM elevation is noisy; naively summing every up-and-down would report
roughly double the real climb. The original implementation smoothed over a
fixed *point count* (5 vertices). Real captured ORS geometry broke that
assumption: on the Ventura corridor, vertex spacing ranged from **1.8 m to
6.8 km** between consecutive points, so a 5-point window was 5 different
filters depending on where you were on the route — heavy over-smoothing on
sparse straight highway, almost no smoothing at all through dense curvy
sections.

The fix smooths over a fixed **real-world distance** (`smoothWindowM`,
default 200 m) instead, so the filter behaves the same regardless of how
densely ORS happened to sample that stretch of road.

There is no clean "correct" window size to discover. Measured on the real
Ventura → South Lake Tahoe route, cumulative ascent runs continuously from
**7,458 m (no smoothing, no dead-band) down to 4,467 m (2,000 m window)**
with no plateau — it is a genuinely sensitive parameter, not one hiding a
stable answer underneath noise:

| Window | Ascent |
|---|---|
| 0 m (unsmoothed) | 7,458 m |
| 200 m (shipped default) | 6,268 m |
| 400 m | 5,736 m |
| 800 m | 5,101 m |
| 1,600 m | 4,601 m |
| 2,000 m | 4,467 m |

**Corrected 2026-08-13:** an earlier version of this table cited a value of
4,029 m at an 800 m window. Two independent reviewers could not reproduce
that figure against the shipped `smoothElevationsByDistance` (both measured
~5,100 m at 800 m instead, matching the table above) — it was almost
certainly computed with a throwaway diagnostic script during tuning, not the
function that shipped. The qualitative conclusion (continuous, non-converging
decline) holds either way; only the specific cited number was wrong. Given
that, 200 m was chosen deliberately on the *smaller* (higher ascent, more
conservative) side of the range: for a planner whose one hard invariant is
never dropping below `reserveFloor`, under-counting a climb risks stranding a
driver on a real grade, while over-counting only costs a few extra minutes of
charging. Precision was not available here; the choice
that fails safe was.

### 5.2 Charge time — closed form, not a simulation loop

Time to go from SOC `a` to SOC `b` across one linear piece of the curve where
power runs `Pa → Pb`:

```
E_per_soc = usableKwh / 100                    # kWh per SOC point
if Pa == Pb:  hours = E_per_soc * (b - a) / Pa
else:         hours = E_per_soc * (b - a) / (Pb - Pa) * ln(Pb / Pa)
```

Sum across the pieces spanned by the window. Effective power is
`P_eff(soc) = min(curve(soc), station.maxKw)` — a 250 kW curve at a 150 kW post
charges at 150.

### 5.3 Departure rule

Leave at whichever comes **first**:
- SOC reaches `departSocTarget`, or
- `P_eff(soc)` drops below `taperCutoffKw`.

**Guard:** if `station.maxKw <= taperCutoffKw`, the taper rule is ignored and we
charge to `departSocTarget`. Without this guard a 100 kW post triggers "taper
cutoff" at 0% and the driver departs having charged nothing.

Total stop time = `chargeMinutes + overheadMinPerStop`. The overhead is the
honest counterweight to shallow hops: six 12→50 stops pay the 5-minute tax six
times, and strategy compare is where that shows up.

### 5.4 Stop selection

```
plan(route, stations, vehicle, strategy, startSoc):
  cum = cumulativeEnergy(route, vehicle)        # elevation-aware, per §5.1
  candidates = stations
      .filter(connector match AND maxKw >= minKw AND status == 'E')
      .sort(by distanceAlongRoute)
  soc = startSoc; pos = 0; stops = []

  loop:
    if destination reachable from (pos, soc) with arriveSoc >= reserveFloor:
        return plan(stops)

    reachable = candidates ahead of pos where arriveSoc >= reserveFloor
    if reachable is empty:
        return infeasible("no charger within range after <place>")

    # prefer the farthest stop that still arrives at or below the target window
    target = farthest s in reachable where arriveSoc(s) <= arriveSocTarget + 3
    if none: target = farthest in reachable          # sparse corridor
    tie-break: higher maxKw, then smaller detour

    departSoc = min(departSocTarget, socWherePowerDrops(taperCutoffKw))
    # ---- corridor override, the lookahead ----
    need = energy from target to (next viable stop or destination) + reserveFloor
    if socFrom(need) > departSoc:
        departSoc = socFrom(need)
        reason = ascent-dominated leg ? "elevation" : "sparse-corridor"
    if departSoc > 100: return infeasible("leg after <station> exceeds range")

    stops.push({...}); soc = departSoc; pos = target.distanceAlongRoute
```

**Invariant the test agent must assert:** `min(arriveSoc over all stops and the
destination) >= reserveFloor`, on every strategy, on every test route. A plan
that violates the floor is a bug, not a warning.

Detour into and out of a station is charged as extra distance and time.
Simplification accepted for v0: detour speed is assumed 35 mph.

### 5.5 Output

- **Stop list:** location, arrive SOC, depart SOC, charge minutes, override
  reason if any.
- **Trip summary:** total time with stops vs the raw no-stop drive time
  (the default baseline), total charge minutes, stop count.
- **Strategy compare:** the same trip under 2–3 saved strategies side by side
  with time deltas.

---

## 6. Wireframe (mobile first, one screen)

```
+--------------------------------+
| wattnap            [=] [instal]|   <- 44px, dark by default
+--------------------------------+
| From  Ventura, CA          [x] |
| To    South Lake Tahoe, CA [x] |
|            [ plan trip ]       |
+--------------------------------+
|                                |
|         M A P                  |   MapLibre, ~55% viewport
|         route polyline         |   charger pins scale w/ kW
|         (o) chargers           |   sleep pins = moon glyph
|         (z) sleep spots        |
|                                |
+--------------------------------+
| min kW  [--------o----] 250    |   <- filter bar, sticky
| net: [Tesla][EA][EVgo][+4]     |
+--------------------------------+
| PLAN   |  CHARGERS  |  SLEEP   |   <- tab bar, thumb reach
+--------------------------------+
| 7h 00m drive -> 8h 09m w/ stops|
| 3 stops * 54 min charging      |
|                                |
| 1  Mojave Supercharger  250kW  |
|    arrive 13%  depart 50%      |
|    18 min                      |
| ---------------------------    |
| 2  Bishop EA            350kW  |
|    arrive 11%  depart 68%  (!) |
|    (!) sparse corridor ahead   |
| ---------------------------    |
| 3  Gardnerville EVgo    200kW  |
|    arrive 14%  depart 50%      |
|                                |
| [ compare strategies ]         |
+--------------------------------+

 tap a pin ->               compare strategies ->
+--------------------------+  +---------------------------+
| Mojave Supercharger      |  |            12-50 | 10-80  |
| Tesla * 250 kW * 12 stalls| |  stops        3  |   2    |
| 1 Main St, Mojave CA     |  |  charging    54m |  71m   |
| open 24h * public        |  |  total     8h09m | 8h21m  |
| kW: reported             |  |  delta        -- | +12m   |
| [ navigate ] [ close ]   |  | [ save as default ]       |
+--------------------------+  +---------------------------+
```

Night legibility: dark theme is the default, not a toggle. Body text >= 16px,
SOC numbers >= 20px, tap targets >= 44px, no pure-white surfaces.

---

## 7. Repo layout

```
wattnap/
  CLAUDE.md  DESIGN.md  STATE.md  README.md
  .github/workflows/deploy.yml      # build + deploy to Pages
  index.html
  src/
    main.js            app shell, tab state
    map/               maplibre setup, layers, pins
    api/               worker client, typed responses
    planner/
      planner.js       pure; the phase 3 core
      curve.js         piecewise interpolation + closed-form integral
      energy.js        elevation-aware leg energy
    ui/                preact components
    data/
      vehicles.json    charge curves
      strategies.json  presets
  public/data/sleep-*.geojson
  scripts/build-sleep-geojson.mjs
  worker/
    src/index.js       router, allowlist, KV cache
    wrangler.toml      NO secrets, secrets via `wrangler secret put`
  test/
    planner.test.js    fixtures: real captured default routes (SLT, Reno);
                        US-395 corridor kept as a supplementary dense-
                        charging stress test, not the shipped default
    fixtures/*.json    frozen route + station responses, no network in CI
```

Tests run against **frozen fixtures** so the phase 3 gate is reproducible and
does not burn NREL quota or depend on a live corridor.

---

## 8. Phases and gates

| # | Phase | Gate (verified by reviewer agent, on the deployed URL) |
|---|---|---|
| 0 | DESIGN.md | **Human approval. The only mandatory human gate.** |
| 1 | Scaffold: repo, Pages deploy via Actions, Worker deploy | Deployed URL renders a route between two typed addresses |
| 2 | Charger corridor: buffer, fetch, kW slider, network toggles, detail card | Slider and toggles filter live AFDC data on the deployed site, Ventura → South Lake Tahoe |
| 3 | Charging strategy planner | Reviewer runs Ventura → South Lake Tahoe and Ventura → Reno under both strategies. Override fires on sparse legs, time deltas are plausible, no plan ever dips below `reserveFloor` |

**Corrected 2026-08-13, gate criterion:** ORS's default routing does not take
US-395 for either trip — verified against the live deployed Worker. Ventura →
South Lake Tahoe goes via I-5 + US-50 (Echo Summit); Ventura → Reno goes via
I-5 + I-80 (Donner Pass). Both are real mountain crossings this section
already names as the reason elevation is modelled, so this is not a weaker
test — if anything it validates §5.1's own examples better than a hand-built
395 fixture would have. The app has no via-waypoint routing (From/To only),
so it cannot force 395; the user chose to accept ORS's default rather than add
that as a feature (D-022). "via US-395" in the original kickoff prompt most
likely described the user's own real driving route, not a requirement that
the routing engine reproduce it by default.
| 4 | Sleep layer: GeoJSON overlays, icons, notes, iOverlander link-out | Pins render with notes and working link-outs on deploy |
| 5 | PWA: manifest, offline shell, saved trips and strategies | Installs on a phone, a saved trip survives reload |
| 6 | Hardening: error, empty, rate-limit states, README | All three states demonstrated, README covers setup, keys, and deploy from zero |

**Definition of done.** On a phone: enter Ventura → South Lake Tahoe, see the
route with 250 kW+ chargers and sleep pins, set the 12→50 window, get a stop plan
with total travel time vs the no-stop baseline, and flip to strategy compare.
Usable for the return leg of the current Tahoe trip. `STATE.md` marked complete.

---

## 9. Open questions — batched, answer before or during the noted phase

| # | Question | Needed by | Fallback if unanswered |
|---|---|---|---|
| Q1 | Basemap tiles: MapLibre demo tiles are dev-only. Options: free MapTiler key (5k loads/mo, key goes in the Worker or is domain-locked), Protomaps PMTiles hosted in the repo (~no limits, larger repo), or OSM raster w/ attribution. Which? | Phase 1 | Protomaps regional extract — no key, no quota, no account |
| ~~Q2~~ | **MEASURED 2026-08-12.** 90 DC fast stations on the Ventura→SLT corridor, **90/90 with reported `power_kw`** (46 at 250 kW+, 11 networks). Coverage is excellent here. The Worker still filters locally (D-011) since coverage elsewhere is not guaranteed | Phase 2 | Closed |
| Q3 | Which connectors should default on? Does the car have a CCS adapter, or is it Superchargers + Magic Dock only? | Phase 2 | Default `TESLA,J1772COMBO`, expose as a toggle |
| Q4 | ORS free tier exact quotas (per day / per minute) — the plans page is JS-rendered and unreadable programmatically | Phase 1 | Read at signup, record here, set cache TTLs accordingly |
| Q5 | Model Y variant and year? (LR / Performance / RWD, and 2020-25 all differ in pack and curve.) Shipped curve is an estimate | Phase 3 | Ship the LR estimate, flag it in the UI as an estimate |
| Q6 | Typical departure SOC — does the car leave home at 80, 90, or 100? | Phase 3 | Default 90, user-editable |
| Q7 | Should Level 2 ever appear (sleep-spot overnight charging), or DC only? | Phase 4 | DC fast only |
| Q8 | Deploy target: `<user>.github.io/wattnap` project page, or a custom domain? Affects the Worker origin allowlist and Vite `base` | Phase 1 | Project page at `/wattnap/` |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| NREL 1,000 req/hr shared across all users of the Worker | 24h KV cache keyed on the canonicalized request; per-IP soft throttle |
| AFDC `power_kw` gaps make the kW filter lie | `kwSource` flag surfaced in the UI; never let the planner treat `inferred` as fact |
| Charge curve estimates make plans confidently wrong | Curve in JSON, labeled an estimate in the UI, validated against a real session in phase 3 |
| Sleep spots go stale | `confirmed` date on every pin, shown in the card |
| Free tiers change or disappear | All upstreams behind the Worker — swapping a provider is one file |
| Elevation model too crude for real terrain | Ascent/descent summed separately; validated against the Echo Summit leg at the phase 3 gate |
