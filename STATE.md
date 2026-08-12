# wattnap — STATE.md

**Single source of truth across sessions. Read before acting. Update before stopping.**

Last updated: 2026-08-12 (session 1, autonomous build run)

---

## Current Phase

**Phase 0 approved by the user on 2026-08-12** ("build it all"), with a
standing instruction to continue autonomously and review on return.

**Phases 1-6 in build.** Repo is live at https://github.com/mysimyg/wattnap and
GitHub Pages is enabled (Actions build type). Deployed URL will be
https://mysimyg.github.io/wattnap/ once the frontend entry point lands.

**Gates are NOT yet certified.** Builders never certify their own work
(`CLAUDE.md`), so a reviewer pass must verify gates 1-6 on the deployed URL
before any of them is recorded as passed below.

---

## Done

| Date | Item |
|---|---|
| 2026-08-12 | `CLAUDE.md` created — operating style, guardrails, session/decision protocols, model plan |
| 2026-08-12 | `DESIGN.md` drafted — architecture, verified API contracts, data schemas, planner algorithm, wireframe, gates, open questions, risks |
| 2026-08-12 | `STATE.md` created |
| 2026-08-12 | Git repo initialized, initial commit |
| 2026-08-12 | API verification: NREL domain migration, AFDC params/fields, OSRM demo terms |
| 2026-08-12 | **Phase 0 gate PASSED** — user approved DESIGN.md and answered Q5, Q6, Q8 |
| 2026-08-12 | Build scaffold: Vite + Preact + MapLibre, Pages deploy workflow, repo created, Pages enabled |
| 2026-08-12 | Planner core (phase 3): curve.js, energy.js, planner.js, geo.js — 24 tests passing |
| 2026-08-12 | Frozen synthetic fixtures for Ventura→SLT and Ventura→Reno via US-395 |
| 2026-08-12 | Worker (phase 1/2 backend): routing, stations, geocode, KV cache, allowlist — 30 tests passing |
| 2026-08-12 | PWA (phase 5): manifest, offline-shell service worker, generated icons |
| 2026-08-12 | README (phase 6): setup, keys, deploy from zero, degradation table, caveats |
| 2026-08-12 | DESIGN.md §2.1 corrected against live AFDC responses (see D-012) |
| 2026-08-12 | Frontend built and integrated; **deployed live at https://mysimyg.github.io/wattnap/** |
| 2026-08-12 | Sleep spot dataset curated: 19 pins, 16 verified, full provenance |
| 2026-08-12 | Live AFDC fixture captured for the corridor; planner re-tested against real stations |
| 2026-08-12 | **Reviewer pass 1** — gate 3 PASS, gates 5 & 6 PASS with gaps, gate 4 FAIL, gates 1 & 2 BLOCKED. 7 defects raised |
| 2026-08-12 | All 7 reviewer defects fixed + 1 the review's own blocker had masked (basemap tiles 404'd on a literal `{r}` in the tile template). 76 tests |
| 2026-08-12 | **Reviewer pass 2** — gate 3 PASS (re-fuzzed 269 plans against real AFDC data, zero floor violations), gate 4 PASS, gates 5 & 6 PASS, gates 1 & 2 still BLOCKED on the Worker. 6 of 7 defects confirmed closed |
| 2026-08-12 | Worker `fetch`-handler tests added, closing the last open defect (rate-limit state now provably reachable). 83 tests |
| 2026-08-12 | Reviewer's new HIGH "map never paints" defect investigated and **found to be a false positive** — WebGL capture artifact, see D-021. Map renders correctly on fresh load |

## In Progress

- Frontend build (phases 1, 2, 4 render, 5 storage, 6 states) — map/UI agent.
- Sleep spot data curation (phase 4 data) — data agent.
- Integration of the above, then a reviewer pass over gates 1-6.

## Next Actions

1. Integrate frontend + sleep data, wire service worker registration into
   `main.jsx`, get the Pages build green.
2. Reviewer agent certifies gates 1-6 on the deployed URL. Record results here.
3. **User, on return:** clear the human tasks below — without the ORS and NREL
   keys and a `wrangler login`, the deployed site can reach no upstreams and
   gates 2 and 3 cannot be certified live (they are certified against fixtures
   only).
4. Replace synthetic fixtures with captured live responses once keys exist.

---

## Human Tasks

Surfaced at session 1. Work around them until cleared.

- [ ] **NREL AFDC API key** — free. **`developer.nlr.gov`**, *not*
      `developer.nrel.gov` (that domain was retired 2026-05-29).
- [ ] **`wrangler login`** to the existing Cloudflare account.
      Note: `wrangler` is not installed on this machine yet (`npx wrangler` works).
- [ ] **GitHub repo** creation, or `gh auth` for the Pages deploy.
      `gh` is installed at `/opt/homebrew/bin/gh`; auth state unverified.
- [ ] **OpenRouteService key** — free at `openrouteservice.org`.
      **Upgraded from optional to recommended.** See decision D-004: the OSRM
      public server's terms do not fit a deployed PWA, and ORS returns the
      elevation data phase 3 needs.
- [x] ~~Answer Q5/Q6~~ — answered 2026-08-12: Juniper Model Y 2025+, 50% start SOC.
- [ ] **Validate the charge curve** against one real Supercharger session and
      update `src/data/vehicles.json`. The shipped Juniper curve is an estimate
      and every charge-minute figure inherits its error.
- [ ] **Set the Worker URL** once the Worker is deployed:
      `gh variable set VITE_API_BASE --body "https://wattnap-api.<subdomain>.workers.dev"`

---

## Decisions Log

| ID | Date | Decision | Why |
|---|---|---|---|
| D-001 | 2026-08-12 | Git repo initialized in place; project name `wattnap` inside the `EV Roadtripping` folder | Reversible, in scope, needed for commits at gates |
| D-002 | 2026-08-12 | Preact (not vanilla) for UI | Stop list + strategy compare are stateful list rendering; vanilla gets worse, not simpler. Still tiny, still Vite |
| D-003 | 2026-08-12 | NREL host is `developer.nlr.gov` | Verified: `developer.nrel.gov` retired 2026-05-29 |
| D-004 | 2026-08-12 | Routing via OpenRouteService through the Worker; OSRM demo = dev-only fallback behind an env flag | Verified OSRM demo policy: non-commercial, 1 req/sec, no uptime guarantee, withdrawable without reason. ORS also returns 3D geometry, which phase 3 elevation needs for free |
| D-005 | 2026-08-12 | `planner.js` is pure — no network, no DOM, no clock | Makes the phase 3 gate testable headlessly against frozen fixtures |
| D-006 | 2026-08-12 | Ascent and descent summed separately, not net elevation | You don't get the climb back at 100%; regen recovers ~70% |
| D-007 | 2026-08-12 | Taper-cutoff rule is ignored when `station.maxKw <= taperCutoffKw` | Otherwise a 100 kW post trips the cutoff at 0% SOC and the driver departs having charged nothing |
| D-008 | 2026-08-12 | Station `kwSource` flag: `reported` / `inferred` / `unknown` | AFDC `power_kw` coverage is incomplete; the planner must never treat a guess as fact |
| D-009 | 2026-08-12 | Phase 3 tests run against frozen fixtures, not live APIs | Reproducible gate, no NREL quota burn in CI |
| D-010 | 2026-08-12 | Vehicle profile is Juniper Model Y (2025+), 78 kWh usable, 235 Wh/mi; default start SOC **50%** | User answered Q5 and Q6. 50% start is unusually low and makes the first stop early — surfaced to the user, kept as the default, editable in the UI |
| D-011 | 2026-08-12 | Worker filters stations by kW **locally**, never via AFDC `ev_power_kw_min` | Upstream filtering silently drops stations whose power is merely unrecorded. Local filtering preserves them and reports `counts.unknownKw` |
| D-012 | 2026-08-12 | DESIGN.md §2.1 corrected: `api_key` is a query parameter; `ev_charging_units[]` nests power as `unit.connectors.<TYPE>.power_kw`; AFDC has no station URL field | Verified against live AFDC responses. The published docs and the wire disagreed; the wire wins |
| D-013 | 2026-08-12 | Basemap is CARTO dark-matter raster + OSM, attribution shown (answers Q1 for now) | No key, no account, dark by default for night legibility. Protomaps vector remains the upgrade path |
| D-014 | 2026-08-12 | Deploy target is the `mysimyg.github.io/wattnap/` project page (answers Q8) | User authorised a public repo and deploys |
| D-015 | 2026-08-12 | Service worker never caches API responses | Stale charger data in a car at night is worse than an honest offline message |
| D-016 | 2026-08-12 | Corridor override reports `overrideDetail` (gap miles, ascent, share) alongside the reason label | A binary sparse-vs-elevation label lies on a leg that is both long and steep |
| D-017 | 2026-08-12 | Planner excludes `kwSource: "unknown"` stations by default and says so in warnings | Never let a guess be treated as a 250 kW stop |
| D-018 | 2026-08-12 | "API not configured" is a banner, not a full-screen replacement | Sleep spots are static files in this repo and the map works without any API. Hiding the whole app hid things that worked, and made gate 4 uncertifiable until the Worker exists |
| D-019 | 2026-08-12 | Basemap tiles use `@2x`, never a `{r}` placeholder | `{r}` is a Leaflet convention that MapLibre passes through literally. **Correction (same day):** the original commit message claimed those URLs 404'd. They did not — CARTO tolerates the malformed suffix and returns a valid non-retina PNG (verified by the reviewer and re-verified from inside the live page). `@2x` is still the correct retina URL, but it fixed nothing. The black map was solely D-018's CSS collapse. Do not reason from the old claim |
| D-021 | 2026-08-12 | Map render is verified by screenshot, never by `getImageData` or canvas pixel sampling | A WebGL canvas without `preserveDrawingBuffer` reads back as uniform black regardless of what is on screen. Both a reviewer pass and the lead independently called the map "broken, renders black" on this false signal, and the second time it cost a wrong root cause and a wasted fix cycle. Screenshot capture is authoritative |
| D-020 | 2026-08-12 | Malformed station coordinates are filtered in `annotateStations`, not allowed to throw | The Worker legitimately emits null coordinates for malformed upstream records. One bad record must not cost the trip every station |

---

## Open Questions

Full table with fallbacks in `DESIGN.md` §9. Summary:

| # | Question | Needed by | Blocking? |
|---|---|---|---|
| ~~Q1~~ | **Answered (D-013)** — CARTO dark raster + OSM attribution | Phase 1 | Closed |
| ~~Q2~~ | **Measured** — 90/90 stations on the corridor report power. Captured as a live fixture | Phase 2 | Closed |
| Q3 | Connector defaults; does the car have a CCS adapter? | Phase 2 | No — default TESLA+CCS |
| Q4 | ORS free tier exact quotas (page is JS-rendered, unreadable) | Phase 1 | No — read at signup |
| ~~Q5~~ | **Answered** — Juniper 2025+. Curve is still an ESTIMATE needing validation | Phase 3 | Partly closed |
| ~~Q6~~ | **Answered** — 50% start SOC | Phase 3 | Closed |
| Q7 | Include Level 2 for overnight sleep-spot charging? | Phase 4 | No — DC only |
| ~~Q8~~ | **Answered (D-014)** — `mysimyg.github.io/wattnap/` | Phase 1 | Closed |

---

## Icebox

New ideas land here, never in the code mid-build.

- BLM / dispersed camping layer (explicitly phase 2 of the sleep data, post-v1)
- Live station availability / occupancy
- Weather and temperature effects on consumption and charge rate
- Multi-day trip splitting with overnight stops as planner constraints
- Amenities near chargers (food, restrooms, dog walking)
- Route alternates comparison
- Share a plan by URL
- Real-world consumption learning from logged trips
- Collapse the trip form once a trip is planned, to give the map more of the
  viewport (currently ~28% on a 812px phone; the wireframe wanted ~55%)
- Vector basemap via Protomaps instead of CARTO raster (Q1 upgrade path)

---

## Model Plan

| Work | Model |
|---|---|
| Phase 0 design and approval | **Opus** |
| Phases 1, 2, 4, 5, 6 build | Sonnet, parallel agents |
| Phase 3 charging math | Opus main thread, Sonnet test agents |
| Pressure test swarms | Sonnet |
| Data wrangling, docs, lint | Haiku subagents |

---

## Next Session

- **Model:** **Sonnet** for remaining build and fixes. Opus only if the charging
  math changes. Switch with `/model`.
- **First task:** deploy the Worker — `npx wrangler login`, create the KV
  namespace, set the three secrets, `npm run worker:deploy` — then
  `gh variable set VITE_API_BASE --body "<worker url>"` and push. That single
  chain unblocks gates 1, 2 and 3 for live certification.
- **Then:** re-run the reviewer pass against the live site and record gate
  results in Done above.
- **Context needed:** `CLAUDE.md`, `STATE.md`, `DESIGN.md`, `README.md` setup section.
- **Blockers:** the human tasks above. The code is built, tested and deployed;
  what is missing is account access I cannot grant myself.
