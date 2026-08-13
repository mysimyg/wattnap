# wattnap — STATE.md

**Single source of truth across sessions. Read before acting. Update before stopping.**

Last updated: 2026-08-13 (session 2)

---

## Current Phase

**Phase 0 approved by the user on 2026-08-12** ("build it all"), with a
standing instruction to continue autonomously and review on return.

**Phases 1-6 in build.** Repo is live at https://github.com/mysimyg/wattnap and
GitHub Pages is enabled (Actions build type). Deployed URL will be
https://mysimyg.github.io/wattnap/ once the frontend entry point lands.

### Gate status — certified 2026-08-13 against the live deployed Worker

| Gate | Phase | Status | Evidence |
|---|---|---|---|
| 0 | DESIGN.md approval | **PASS** 2026-08-12 | User approved, answered Q5/Q6/Q8 |
| 1 | Scaffold | **PASS** 2026-08-13 | Reviewer drove the live site end to end: real geocode, real route render, zero JS exceptions incl. under a 5x rapid-submit stress test |
| 2 | Charger corridor | **PASS** 2026-08-13 | Reviewer instrumented `window.fetch` and proved the client/server filter split exactly: kW slider and network toggles filter 0 network calls; only the corridor-distance control re-fetches |
| 3 | Charging planner | **PASS** 2026-08-13 | Two independent reviewers, ~19,000 fuzzed trials + hand-verified math against the real default-route fixtures (not the old 395 ones). Zero reserve-floor violations found. See findings below — this pass surfaced a real hardening gap, now fixed |
| 4 | Sleep layer | **PASS** 2026-08-12 | Verified live across all 3 categories: notes, confirmed dates, working source link-outs |
| 5 | PWA | **PASS** 2026-08-12 | Manifest and SW register at the correct base path; a seeded trip survives reload. Real-phone install unverifiable by an agent |
| 6 | Hardening | **PASS** 2026-08-12 | Error/empty/rate-limit states demonstrated; rate limit proven reachable through the real `fetch` handler; README verified as setup-from-zero |

**All six phase gates now PASS.** Definition of done (DESIGN.md) is functionally
met: on a phone, Ventura → South Lake Tahoe, real 250kW+ chargers and sleep
pins, the 12→50 window, a real stop plan with total time vs. no-stop baseline,
strategy compare. Verified live by both the lead and the reviewer workflow.

**2026-08-13 gate 1-3 re-certification found 3 live UI defects and 3 planner
hardening gaps, all now fixed** (see Decisions Log D-025 onward). None were
gate blockers under DESIGN.md's literal criteria, but two were genuine
driver-facing correctness bugs:
- A resolved From/To field kept using its OLD coordinate if the user typed
  over it without picking a new suggestion — silently planning the wrong
  trip with no warning. **Fixed.**
- A failed re-plan left the previous route line drawn on the map while the
  panels correctly showed an error. **Fixed.**
- `reserveFloor` (the one hard safety invariant) wasn't validated inside the
  pure planner — a corrupted/hand-edited saved strategy with a negative value
  could produce a plan reporting `feasible: true` with a physically
  impossible negative destination SOC. Not reachable via the shipped UI
  slider, but reachable via localStorage tampering. **Fixed** — see D-025.

**Open, not fixed — needs your decision, not a code fix:** one reviewer
measured that on the real default corridor, the planner's "prefer the
farthest reachable station" scoring routinely leaves as little as ~0.16 SOC
points (~0.5 miles) of real margin above `reserveFloor` on some legs. This is
not a bug — the invariant holds by construction — but it means there is
effectively zero cushion between "the elevation/charge-curve model is
slightly wrong" and "a real driver arrives below the stated safety floor."
Compounds with the charge curve still being an unvalidated estimate. See
"Open Questions" and the Decisions Log for detail — **this needs a product
decision** (bias stop-selection to leave more margin? raise the effective
internal floor above the displayed one? something else?), not something to
silently pick a default for.

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
| 2026-08-13 | Worker deployed live at https://wattnap-api.mattswartz.workers.dev, all three API keys configured, KV namespace wired up. `VITE_API_BASE` set as a repo variable and pushed |
| 2026-08-13 | Housekeeping: a `.dev.vars.md` file with live keys was NOT covered by `.gitignore`'s `.dev.vars` pattern — moved to the correct `worker/.dev.vars` name and gitignore widened to `.dev.vars*`. A stray nested clone (`wattnap/`, clean, identical to the outer repo) removed |
| 2026-08-13 | Live smoke test found neither Ventura trip's default ORS route takes US-395 — see D-022. User chose to accept the default route over adding via-waypoint routing |
| 2026-08-13 | Real route + station fixtures captured for both actual default corridors (SLT via Echo Summit, Reno via Donner Pass); 220 and 254 real DC fast stations respectively, 100% reporting power |
| 2026-08-13 | Elevation smoothing bug found and fixed on real data: point-count window was inconsistent across ORS's wildly variable vertex spacing. Switched to distance-based, see D-023, D-024 |
| 2026-08-13 | 91 tests passing (up from 83): 8 new — 2 for the point-density smoothing fix, 6 against the real default-route fixtures |
| 2026-08-13 | **Gates 1-3 re-certified via a Workflow** (1 reviewer for gates 1-2 live on the deployed URL, 2 independent adversarial reviewers for gate 3). All PASS. **All six phase gates now PASS** |
| 2026-08-13 | Fixed: stale resolved From/To coordinate silently reused after editing text past a picked suggestion (MEDIUM-HIGH, driver-facing) |
| 2026-08-13 | Fixed: failed re-plan left the previous route line on the map while panels correctly showed an error (MEDIUM) |
| 2026-08-13 | Fixed: `plan trip` had no in-flight guard; rapid taps could fire duplicate `/v1/route` calls against real quota (LOW) |
| 2026-08-13 | Fixed: `reserveFloor` (and sibling strategy fields) weren't validated inside the pure planner — a corrupted saved strategy could produce `feasible: true` with a negative destination SOC. Clamped, matching the pattern already used for `overheadMinPerStop` |
| 2026-08-13 | Fixed: `smoothElevationsByDistance` had no guard against a negative window, silently producing wrong (not crashing) output |
| 2026-08-13 | Fixed: DESIGN.md §5.1.1 cited sensitivity numbers (800m → 4029m) that two independent reviewers could not reproduce against the shipped code (actual: ~5,101m). Corrected with a full table, actually verified |
| 2026-08-13 | 94 tests passing (up from 91): 3 new regressions matching the reviewers' exact repros |
| 2026-08-13 | **Open, unresolved:** reserve-floor margin on the real corridor measured as low as ~0.16 SOC points on some legs — an inherent property of the "prefer farthest reachable" scoring, not a bug. Needs a product decision, not a code fix. See Open Questions Q9 |
| 2026-08-13 | **User hit a live bug** (screenshot: "Ventura, CA, USA" → "Tahoe City, CA, USA" failed with "Upstream service unavailable") — this was Q10. Root-caused and fixed same session: ORS's default point-snap radius (~350m) couldn't reach a real road from the Pelias administrative-centroid point for "Ventura, CA" (geocodes to a beach). Worker now sends `radiuses: [5000, 5000]`. Confirmed live before/after on the exact failing request; 95 tests |

## In Progress

- Frontend build (phases 1, 2, 4 render, 5 storage, 6 states) — map/UI agent.
- Sleep spot data curation (phase 4 data) — data agent.
- Integration of the above, then a reviewer pass over gates 1-6.

## Next Actions

**All six phase gates now PASS. The build is functionally done per DESIGN.md's
Definition of Done.** What's left is hardening and one product decision:

1. **User decision needed (Q9, D-029):** should stop-selection leave more real
   margin above `reserveFloor`? No safe default exists to silently pick — it's
   a genuine time-vs-safety-margin trade-off. See STATE.md's gate-3 findings
   above for the concrete number (~0.16 SOC points measured on a real leg).
2. Validate the Model Y charge curve against a real Supercharger session —
   the largest remaining unvalidated input in the charging math (see Human
   Tasks). Everything else in the math has now been checked against real
   captured data.
3. Low-priority polish logged but not done: inverted-SOC-target strategies
   produce a slow ~26-stop degenerate plan before correctly failing, with no
   upfront validation message (cosmetic, not a safety issue).

---

## Human Tasks

- [x] ~~NREL AFDC API key~~ — configured 2026-08-13, `developer.nlr.gov`.
- [x] ~~`wrangler login`~~ — done 2026-08-13. Worker deployed at
      https://wattnap-api.mattswartz.workers.dev.
- [x] ~~GitHub repo / `gh auth`~~ — repo live, Pages deploying via Actions.
- [x] ~~OpenRouteService key~~ — configured 2026-08-13. Confirmed live:
      routes return real elevation (`elevationAvailable: true`).
- [x] ~~Answer Q5/Q6~~ — answered 2026-08-12: Juniper Model Y 2025+, 50% start SOC.
- [ ] **Validate the charge curve** against one real Supercharger session and
      update `src/data/vehicles.json`. The shipped Juniper curve is an estimate
      and every charge-minute figure inherits its error. This is now the
      single largest unvalidated input in the charging math — everything else
      (station data, route elevation, the reserve-floor invariant) has been
      checked against real captured data as of 2026-08-13.
- [x] ~~Set the Worker URL~~ — `VITE_API_BASE` set as a repo variable 2026-08-13.
- [ ] **Decide Q9** (D-029): accept the current stop-selection margin, or bias
      it toward leaving more real-world cushion above `reserveFloor`? See the
      gate-3 findings above.
- [ ] **Wrangler is on v3.114**; v4 exists (`npm install --save-dev wrangler@4`).
      Not urgent — flagged so it isn't forgotten, config format may change.

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
| D-022 | 2026-08-13 | Accepted ORS's default routing (I-5+US-50 to SLT via Echo Summit, I-5+I-80 to Reno via Donner) rather than adding via-waypoint routing to force US-395 | Measured against the live Worker: neither trip's default route touches 395. User chose to ship the default behavior over building a route-forcing feature. DESIGN.md §8 gate 3 wording corrected; via-waypoint routing is not on the roadmap unless requested |
| D-023 | 2026-08-13 | Elevation smoothing switched from a fixed point-count window (5 vertices) to a fixed real-world distance window (200m) | Real captured ORS geometry has vertex spacing from 1.8m to 6.8km on this project's own corridor; a point-count window was a different filter everywhere depending on local point density. Distance-based smoothing behaves consistently. The 200m default was chosen deliberately on the higher-ascent (more conservative) side of a genuinely non-converging sensitivity range — see DESIGN.md §5.1.1 |
| D-024 | 2026-08-13 | Real Ventura corridor ascent measured at ~6,300m for both SLT and Reno, roughly double the original ~3,000m estimate | The real default route crosses two mountain ranges (Tejon + Sierra), not one. This is measured, not estimated — see test/fixtures/route-*-default-live.json |
| D-025 | 2026-08-13 | `reserveFloor`, `arriveSocTarget`, `departSocTarget` clamped inside `planTrip` itself, not trusted from the strategy object | Reviewer repro: `reserveFloor: -20` on a real fixture produced `feasible: true` with `arriveSocAtDestination: -19` — the literal invariant held against itself but the safety intent was defeated. Destructuring defaults only catch `undefined`, not `null`, which was silently coercing to an effective 0% floor. Not reachable via the shipped UI (slider-bounded), but reachable via a hand-edited localStorage strategy |
| D-026 | 2026-08-13 | Editing a resolved From/To field without picking a new suggestion now immediately invalidates the old resolved coordinate | Previously the stale coordinate stayed live in the store — `plan trip` stayed enabled and silently planned the OLD location while the box showed different text. Found live by the gate reviewer; the failure mode is a distracted driver correcting an address and not noticing it didn't take |
| D-027 | 2026-08-13 | A failed re-plan now clears the map's route line and corridor overlay, not just the text panels | Previously the map kept showing the last successful route while PLAN/CHARGERS correctly showed an error — a driver glancing only at the map would think a route still existed |
| D-028 | 2026-08-13 | `planTripFlow` guards against concurrent invocation at the function level, not just via the disabled button attribute | The DOM `disabled` state lags one render behind a click; a rapid double-tap could still fire two real requests against shared NREL/ORS quota before the button visually disabled |
| D-029 | 2026-08-13 | **Open — not resolved.** Reviewer measured the planner's stop-selection scoring ("prefer the farthest reachable candidate") leaves as little as ~0.16 SOC points of real margin above `reserveFloor` on the actual default corridor | This isn't a bug — the floor invariant holds by construction, proven under ~19,000 fuzzed trials — but it means there is effectively zero cushion between "the elevation or charge-curve model is slightly wrong" and "a real driver arrives below the stated safety floor." Whether to bias the scoring toward more margin (fewer, closer-in stops) is a real product trade-off (more conservative = more/longer stops), not a code-correctness fix. See Open Questions Q9 |
| D-030 | 2026-08-13 | ORS directions requests now send `radiuses: [5000, 5000]` (5 km point-snap search radius per waypoint), not ORS's tight ~350 m default | The user hit this live: "Ventura, CA, USA" → "Tahoe City, CA, USA" failed with "Upstream service unavailable." Root cause: ORS's default snap radius couldn't reach a real road from the Pelias administrative-centroid point for "Ventura, CA" (it geocodes to a beach). Confirmed live before/after on the exact failing request. Body construction extracted to `buildOrsDirectionsBody` so this is now unit-tested without live network |

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
| Q9 | Should stop-selection scoring leave more real-world margin above `reserveFloor` than "prefer the farthest reachable station" currently does (measured as low as ~0.16 SOC points on a real leg)? | Post-gate hardening | **User decision needed** — no safe default to silently pick, since it's a real time-vs-margin trade-off. See D-029 |
| ~~Q10~~ | **Fixed 2026-08-13 (D-030)** — user hit this live (screenshot: "Ventura, CA, USA" → "Tahoe City, CA, USA", `Upstream service unavailable`) | Post-gate hardening | Closed |

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

**All six phase gates PASS as of 2026-08-13. The build meets DESIGN.md's
Definition of Done.** This is a hardening/polish session, not a build session.

- **Model:** Sonnet. Nothing left needs Opus-level charging-math design work.
- **First task:** get the user's decision on Q9 (D-029) — whether
  stop-selection should leave more real-world margin above `reserveFloor`.
  This is the one open item that's a genuine product trade-off, not a code fix.
- **Then, if there's runway:** validate the charge curve against a real
  Supercharger session (the largest remaining unvalidated input).
- **Context needed:** `CLAUDE.md`, `STATE.md` in full (Decisions Log D-018
  onward covers everything from the Worker deploy through gate re-certification),
  `DESIGN.md` §5.1.1, §8, §9.
- **Blockers:** none. Everything that needed account access is done.
