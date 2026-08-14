# wattnap — STATE.md

**Single source of truth across sessions. Read before acting. Update before stopping.**

Last updated: 2026-08-13 (Clearcoat visual restyle, phases 1-6 complete)

---

## Current Phase

**Visual restyle (Clearcoat direction) complete, independent review pass in
progress.** DESIGN.md's original six build-phase gates (below) all passed on
2026-08-13; a separate design pass then handed off `wattnap-spec.md` (a
Claude Design token/CSS spec, saved into the repo root) asking for a
CSS-and-markup-detail restyle against the existing component tree — not a
rebuild, not a structural change. That restyle is now done: 16 commits (one
per phase/screen), 124 tests passing throughout, every phase verified live
against the deployed Worker as it landed. See "Clearcoat restyle — session
summary" below for the full account; this section stays about the original
six DESIGN.md gates.

Repo is live at https://github.com/mysimyg/wattnap and GitHub Pages is
enabled (Actions build type). Deployed URL will be
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

**Resolved 2026-08-13 (Q9, D-039):** a reviewer had measured that the
planner's "prefer the farthest reachable station" scoring leaves as little as
~0.16 SOC points of real margin above `reserveFloor` on some legs, and flagged
it as needing a product decision. Asked the user directly. Their answer
redirected the question: charger/SOC precision matters less than assumed --
the plan is "directional" and they'll adapt to whatever charger is actually
there. The real anxiety was sleep availability, not charge margin. Reserve-
floor scoring is unchanged; the actual fix was widening sleep-spot search
(D-039) and adding jurisdiction advisories (D-040, Q11) instead. The charge
curve is still an unvalidated estimate and still the largest remaining
uncertainty in the charging math -- see Human Tasks and the charge-curve
research prompt below -- but the margin question itself is closed.

---

## Clearcoat restyle — session summary (2026-08-13)

**Source:** `wattnap-spec.md` (repo root), transcribed from a Claude Design
handoff doc the user attached. Its own §11 is the prompt this session ran
against; §12 documents spec-level gaps found and how they were resolved
rather than guessed at.

**Scope discipline:** `src/planner/*` has zero diff across all 16 commits —
grep-verifiable. `worker/*` changes are limited to the phase-6 `/v1/route`
waypoints[] change, as pre-authorized. Confidence language (`kwSource`,
`verified`, advisory strings) got louder everywhere it appears, never
softened — the confidence ladder (phase 3) and its live application at every
site was the main mechanism for that.

**Phases, one commit each (finer-grained within phase 5 — one per screen):**
1. Token layer — full §2/§3 scale + palette, transitional `--radius`/
   `--border` aliases (deleted once every consumer migrated, in the phase 5
   cleanup commit plus one follow-up that caught 4 stragglers in
   never-touched files: `Header.jsx`, the `.wn-app` shell, one PlanPanel
   rule, the scrollbar thumb).
2. Primitives — `.wn-btn`/`.wn-icon-btn`/`.wn-chip`/`.wn-input`/`.wn-card`/
   `.wn-state` onto the token scale; `.wn-chip` drops `border-radius:999px`.
3. Confidence ladder — `.is-measured`/`.is-inferred`/`.is-unknown` + §4 data
   tokens; applied at every `kwSource`/`verified` site (new shared
   `KwBadge`, sleep list rows, a new 4-segment advisory meter).
4. Pins — squircle, 7 inlined Lucide icons (verified against upstream
   source, not hand-drawn from memory) keyed by `sleep-index.json`'s `icon`
   field (source-of-truth updated in `scripts/build-sleep-geojson.mjs`, not
   just the generated file — the build script would have silently reverted
   a direct edit on its next run).
5. Screens — Plan (hero headline, charge-window track, override reason
   block replacing a bare "!" badge), Chargers (compact filter summary),
   Sleep (advisory header band, category chip icons), detail card (icon
   square, glass blur, X-close freeing the footer for two actions), the
   three sheets (real slide-up sheet motion via previously-unused tokens),
   empty/error states (found and fixed 3 latent bugs — see below), desktop
   column + map chrome (glass nav control, re-anchored attribution).
6. Multi-stop + round trip — the only phase with real logic. Implemented as
   `planTrip()` called once per leg, completely unmodified; a via is a leg
   boundary because orchestration outside the planner treats it as one, not
   because the planner learned a new concept. Full design in D-043 below.

**Bugs found and fixed while restyling (not part of the ask, found by
touching adjacent code and checking computed styles rather than trusting
the diff by eye):**
- `--warn-border`/`--warn-bg`/`--warn-text` were referenced with fallbacks
  throughout but never defined anywhere in `:root` — silently running on
  hardcoded fallback literals since D-040 shipped. Two reviewer passes
  before this session hadn't caught it either.
- `.wn-badge`'s base rule forced every badge into a fixed 20x20 circle, a
  leftover from a single-character "!" badge that no longer exists in the
  codebase — the two remaining consumers (confidence tiers, "unverified")
  are text pills that were overflowing their box.
- A self-introduced bug caught before shipping: fixing the above briefly
  left two competing `.wn-badge--warn` rules where text color and
  background both resolved to `var(--warn)` — invisible text on its own
  background. Caught by testing computed styles, not by eye.
- `wattnap-spec.md` §3's light-mode `--surface: oklch(1 0 0)` is pure
  white, contradicting the spec's own "no pure white, no pure black,
  anywhere" self-check — both values came from the same handoff doc.
  Changed to `oklch(.995 0 298)`.

**Spec self-contradictions found and documented (`wattnap-spec.md` §12),
not silently resolved:** light-mode hue 298 vs. the stated "hue 285
throughout" (implemented hue-for-hue as written — internally consistent
within each block, reads as intentional); a `--tiles` custom property with
no corresponding basemap logic (defined as written, doesn't yet switch
tile URLs — out of scope for a CSS pass); the pure-white `--surface` above.

**Judgment calls made where the spec gave a range, an unstated exact
number, or named something without specifying it — documented inline in
the relevant commit rather than blocking on each one:** confidence-meter
fill-per-tier (reserves one segment permanently dashed even at "high");
sleep-pin fill opacity (18%, spec said "16-20%"); category icon-stroke
lightening via `color-mix` rather than a hand-computed per-hue oklch value;
TabBar/trip-bar icon choices (route/zap/moon/map — spec named the four
items, not their icons); via reordering via up/down buttons instead of
pointer drag (a real cross-device drag implementation is a materially
bigger sub-project than the rest of this pass; reaches the identical end
state).

**Explicitly deferred, not silently dropped** (matching the spec's own
precedent for the label-tab and marker-performance items it names as
future work): the pin label tab at zoom>=8 (§6); moving pins to a MapLibre
symbol layer (§9-3); endpoint (start/destination) markers (§6) — styling
them needs new marker-lifecycle wiring in `map/index.js` keyed to route
state, which is functional scope beyond "route line + casing colours
only," and no endpoint markers exist today either, so nothing regressed.

**D-043 — Multi-stop resolves an apparent DO-NOT-TOUCH conflict.** The
build prompt lists `src/planner/*` as DO NOT TOUCH, no exceptions, while
§8/§9-1 describe the planner "treating a via as a leg boundary." Read
literally these conflict. Resolution, confirmed by reading the actual
planner (it operates on one `{distance_m, duration_s, geometry}` route at
a time, with zero concept of multiple legs): multi-stop is built entirely
*outside* the planner. The Worker splits one ORS multi-waypoint response
into per-leg geometry slices (`splitIntoLegs`, keyed off each segment's
`steps[].way_points`); `state.js`'s `recomputePlan` calls the same
unmodified `planTrip()` once per leg, feeding leg N+1 whatever SOC leg N's
plan actually arrived at. The planner never learns a new concept; it's
called more than once. `src/planner/*` has a zero-line diff across the
entire session as a result.

**D-044 — Worker deploy required explicit user sign-off.** Verifying phase
6 needed the deployed Worker running the new `/v1/route` shape (local
`wrangler dev` hit a pre-existing wrangler-3.114/module-exports
incompatibility, unrelated to this session's changes — see the existing
"Wrangler is on v3.114" Human Task). `npm run worker:deploy` was blocked by
the permission classifier as a production action. Asked the user directly
rather than working around it (e.g. by skipping live verification
silently); they approved deploying. Live-verified afterward against a real
Ventura→Bakersfield→South Lake Tahoe trip: 2 correctly-split legs, a via
milestone reading "Arrive Bakersfield, CA, USA at 11%", 4 sequentially-
numbered charging stops, a leg-prefixed warning, round trip closing the
spine. Also caught and fixed live: the client sending `{waypoints}` against
a not-yet-redeployed Worker still expecting `{from,to}` — the exact
regression this deploy-then-verify order was designed to catch.

**Verification method throughout:** every phase tested against real data
(the deployed Worker + a live `.env.local` pointed at it, gitignored) via
computed-style assertions, not just screenshots — this project's own
D-021/D-042 already document that canvas/WebGL screenshot capture is
unreliable in this session's browser tool, and that pattern held again
here (light mode's CSS cascade verified 100% correct via
`getComputedStyle` while a screenshot of the same state looked unchanged).
124 tests pass throughout, up from 108 at session start (16 new: worker
leg-splitting/multi-waypoint radius tests, a sleep-data harmonised-
lightness regression test, and 10 tests covering the multi-leg
orchestration logic the blocked-then-approved deploy couldn't verify live
on the first attempt).

**Not yet done:** an independent multi-dimension review pass (DO-NOT-TOUCH
compliance, spec fidelity, the build prompt's own self-check list,
cross-file consistency) was launched via Workflow before this summary was
written. If this line is still here, treat the restyle as builder-verified
but not yet independently reviewed — see the next dated STATE.md update or
the git log after this one for the outcome. Per CLAUDE.md: "the reviewer or
test agent verifies the gate. Builders never certify their own work."

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
| 2026-08-13 | Sleep spots: real route-proximity filtering added (previously none existed) plus a user-adjustable search radius, default 20mi, independent of the charger corridor. Resolves Q9 by redirection -- see D-039 |
| 2026-08-13 | Jurisdiction advisories added for restricted-sleeping cities (South Lake Tahoe, Reno, Stateline/Douglas County), citing the ordinance and naming the nearest legal pin live. Resolves Q11 -- see D-040 |
| 2026-08-13 | 106 tests passing (up from 98): 8 new covering proximity filtering and jurisdiction matching |
| 2026-08-13 | **Reviewer pass 3 (Workflow)** on the sleep-detour + jurisdiction features: 3 HIGH, 2 MEDIUM, 1 LOW defect found. All 6 fixed same session, 3 HIGH ones re-verified live against the reviewer's exact repro cases post-deploy. See D-041 |
| 2026-08-13 | Map-render investigation: a wattnap-independent, CDN-loaded MapLibre instance also fails to fire `load` in this session's test browser tool -- attributed to the same tooling limitation D-021 documented, not an app regression. Defensive fix kept regardless. **Needs real-device confirmation next session.** See D-042 |
| 2026-08-13 | 108 tests passing (up from 106): 2 new covering the verified-first nearest-option fix |
| 2026-08-13 | **Gates 1-3 re-certified via a Workflow** (1 reviewer for gates 1-2 live on the deployed URL, 2 independent adversarial reviewers for gate 3). All PASS. **All six phase gates now PASS** |
| 2026-08-13 | Fixed: stale resolved From/To coordinate silently reused after editing text past a picked suggestion (MEDIUM-HIGH, driver-facing) |
| 2026-08-13 | Fixed: failed re-plan left the previous route line on the map while panels correctly showed an error (MEDIUM) |
| 2026-08-13 | Fixed: `plan trip` had no in-flight guard; rapid taps could fire duplicate `/v1/route` calls against real quota (LOW) |
| 2026-08-13 | Fixed: `reserveFloor` (and sibling strategy fields) weren't validated inside the pure planner — a corrupted saved strategy could produce `feasible: true` with a negative destination SOC. Clamped, matching the pattern already used for `overheadMinPerStop` |
| 2026-08-13 | Fixed: `smoothElevationsByDistance` had no guard against a negative window, silently producing wrong (not crashing) output |
| 2026-08-13 | Fixed: DESIGN.md §5.1.1 cited sensitivity numbers (800m → 4029m) that two independent reviewers could not reproduce against the shipped code (actual: ~5,101m). Corrected with a full table, actually verified |
| 2026-08-13 | 94 tests passing (up from 91): 3 new regressions matching the reviewers' exact repros |
| 2026-08-13 | **Open, unresolved:** reserve-floor margin on the real corridor measured as low as ~0.16 SOC points on some legs — an inherent property of the "prefer farthest reachable" scoring, not a bug. Needs a product decision, not a code fix. See Open Questions Q9 |
| 2026-08-12 | **Sleep-spot dataset rebuilt for the real corridor.** 19 pins -> 43 across 7 categories, via 6 parallel research agents. Longest gap with nowhere to sleep: SLT **414mi -> 76mi**, Reno **337mi -> 76mi** |
| 2026-08-12 | Built `scripts/audit-sleep-coverage.mjs` — measures the LONGEST STRETCH OF ROUTE with no sleep spot, the question a pin count cannot answer. Enforced by test |
| 2026-08-12 | **Found 6 shipped rest-area pins were closed for construction while marked `verified:true`** — including both Tejon Pass records, which were the ONLY coverage within 5mi of the entire 491mi Tahoe route. Verified independently against the Caltrans live feed |
| 2026-08-12 | Added `status` field + `scripts/check-rest-area-status.mjs`; build now refuses to ship closed facilities |
| 2026-08-12 | **UI now surfaces `verified:false`** (warning in card, badge in list). It previously did not, so community-sourced pins were indistinguishable from official Caltrans data |
| 2026-08-12 | Corrected two factual errors in existing data: camping ban is 21 CCR **2205(a)** not (b); Horizon Casino was **rebranded** (now Golden Nugget Lake Tahoe, open), not permanently closed |
| 2026-08-13 | **User hit a live bug** (screenshot: "Ventura, CA, USA" → "Tahoe City, CA, USA" failed with "Upstream service unavailable") — this was Q10. Root-caused and fixed same session: ORS's default point-snap radius (~350m) couldn't reach a real road from the Pelias administrative-centroid point for "Ventura, CA" (geocodes to a beach). Worker now sends `radiuses: [5000, 5000]`. Confirmed live before/after on the exact failing request; 95 tests |
| 2026-08-13 | Rest-area status re-check against the live Caltrans SRRA feed (feed stamped 08/13/2026 6:11am). Gaviota N/S, Tejon Pass NB and Coso Junction confirmed still CLOSED (reopen dates and closure reasons now recorded). **Gold Run westbound has REOPENED** and is a live pin again — it had been wrongly suppressed for a day. Tejon Pass SB note corrected: the feed has no SB record at all (the two entries are a duplicate of NB), so it stays suppressed as unknown, not as confirmed-closed. Rest-area pins 10 → 11; 98 tests |
| 2026-08-13 | **Clearcoat visual restyle — all 6 phases complete, 16 commits.** `wattnap-spec.md` (Claude Design handoff) implemented in full: token/palette layer, primitives, confidence ladder applied everywhere, squircle pins with per-category Lucide icons, all 7 named screens restyled, and multi-stop/round-trip routing (via waypoints, the only phase with real logic — planner untouched, orchestration outside it). Found and fixed 3 latent bugs unrelated to the restyle ask while touching adjacent code (undefined `--warn-*` fallback vars, a badge sized for a glyph that no longer exists, a pure-white value the spec's own self-check forbids). See "Clearcoat restyle — session summary" above for full detail; D-043/D-044 below. 124 tests, up from 108 |

## In Progress

- Independent review pass on the Clearcoat restyle (launched via Workflow; see the session summary above for status as of this writing).

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
| D-031 | 2026-08-12 | Sleep categories expanded to rest-area, truck-stop, walmart, cracker-barrel, casino, outdoor-retail, dispersed-nf, host-network | Scope change, explicitly requested by the user. The original three left 414mi of the real route empty because they were curated for a US-395 corridor the router abandoned. `blm` stays blocked; `dispersed-nf` is a separate self-contained slug so it can be dropped as one set |
| D-032 | 2026-08-12 | `status` ("open"/"closed") added, deliberately separate from `verified`; closed records keep provenance but never ship as pins | `verified` answers "was this real when we checked" and decays silently; `status` answers "is it open right now". Six pins were verified:true AND closed. Sending a tired driver to a locked gate is worse than showing nothing |
| D-033 | 2026-08-12 | Coverage is measured as LONGEST GAP along the real route, not pin count, and guarded by a test (<120mi) | 200 pins clustered in Sacramento still leaves the Central Valley empty. Only the gap metric answers the driver's actual question |
| D-034 | 2026-08-12 | No pins at all in jurisdictions that ban vehicle sleeping outright — South Lake Tahoe (City Code Ch. 4.70, covers PRIVATE property) and Reno (RMC 8.22.035) | A pin implies "you may sleep here." Where an ordinance says otherwise, the honest dataset answer is absence. Note this means the reference trip's own destination has no pin — deliberate |
| D-035 | 2026-08-12 | Los Banos Walmart downgraded from verified:true to verified:false by the integrating session | Its own research note rated confidence MEDIUM-LOW, three first-hand reports disagreed, and a citywide ordinance may ban vehicle sleeping 10pm-6am. That is not "confirmed policy". Kept as a pin (only option in a 175mi dead zone) but must not read as confirmed — same standard as D-034 |
| D-039 | 2026-08-13 | Sleep-spot proximity filtering is now real (it wasn't at all before) and independently adjustable from the charger corridor, defaulting to 20mi | Resolves Q9. The user redirected the question: SOC/charger precision matters less than they'd assumed ("directional," they'll adapt), sleep availability is what actually worries them at 2am. Sleep spots had NO distance filtering before this -- every pin in an enabled category showed everywhere, which only looked right because the dataset happened to sit near one corridor. Reserve-floor scoring itself (D-029) left unchanged; this addresses the real underlying concern instead |
| D-041 | 2026-08-13 | Fixed 6 defects an independent live-site reviewer found in D-039/D-040: MapView's sleep effect missing `s.route`/`s.sleepDetourMi` deps (map went stale on detour change), jurisdiction nearest-option now prefers verified pins (was recommending a source-conflicted unverified casino), `sleepDetourMi` now persists across save/reload, confidence tiers now visually distinct, a grounded (not fabricated) note added on the Douglas County "designated area" question, empty-state copy fixed. All 3 high-severity fixes re-verified live against the reviewer's exact repro cases post-deploy (Reno nearest-option now correctly names Gold Ranch not Boomtown; 10mi detour survives reload) |
| D-042 | 2026-08-13 | **Map-render "black map" claim from the D-041 reviewer pass investigated and attributed to the test tool, not the app** -- extends D-021, does not reverse it | The reviewer found zero CARTO tile requests fire in the deployed app in this session's browser tool. Investigated hard: ruled out sizing (container/canvas correctly dimensioned), CORS (tiles load fine cross-origin with and without `crossOrigin=anonymous`), rate limiting, and a stale service worker. Decisive test: a MINIMAL MapLibre instance loaded fresh from a CDN, with zero wattnap code involved, ALSO never fires its own `load` event in this tool. That is strong evidence this is the same class of tooling limitation D-021 already documented (WebGL/canvas unreliability in this specific embedded browser pane), not a regression in the app. Kept the defensive fix anyway (`nudgeMap()` in `src/map/index.js` -- `map.resize()` plus a real `window` resize dispatch on every observed container-size change, since a bare `map.resize()` call was observed NOT to be reliably sufficient on its own) since it is low-risk and can only help. **Not independently confirmed working or broken on a real phone/desktop** -- next session should verify on real hardware before spending more time chasing this in-tool |
| D-040 | 2026-08-13 | Jurisdiction advisories added: `src/data/restricted-jurisdictions.json` + a Sleep-tab notice when a trip endpoint falls in a restricted city, citing the ordinance, stating confidence honestly, and naming the nearest legal pin (computed live, not hardcoded) | Resolves Q11 (user: "I do think it's important to show those warnings"). Scope note: user clarified they will NOT sleep in the car at either reference destination (Tahoe/Reno) -- a hotel covers that. The advisory is about honesty when a driver browses those cities, not the load-bearing fix; D-039's wider search radius is |
| D-038 | 2026-08-13 | Desktop is now a first-class target, not just mobile: two-column layout at >=1024px (controls left, map right full-height) plus a map expand/full-screen toggle at every width | User stated they will use this from a laptop/desktop as much as from a phone. DESIGN.md's "mobile first, one screen" constraint capped `.wn-app` at 920px, which wasted a laptop screen on the one element that most wants it. Deliberately STRUCTURAL only (layout + behaviour, no visual restyle) because a design overhaul is planned separately in Claude Design — this should survive it |
| D-037 | 2026-08-13 | `check-rest-area-status.mjs` now reads `scripts/sources/*.json` instead of the built GeoJSON, and reports drift in BOTH directions | Reading the built output meant a `status:"closed"` record was invisible to the checker and could never be seen to reopen — exactly how Gold Run westbound stayed suppressed after coming back. A missed closure strands someone; a missed reopening quietly costs a stop. Closes Q14 |
| D-036 | 2026-08-12 | Private-host networks (Boondockers Welcome, Harvest Hosts) will NOT be surfaced | Both explicitly exclude sleeping in a car/SUV in their own help centres — precisely wattnap's use case. Pointing users at services that name them ineligible would be misleading |
| D-030 | 2026-08-13 | ORS directions requests now send `radiuses: [5000, 5000]` (5 km point-snap search radius per waypoint), not ORS's tight ~350 m default | The user hit this live: "Ventura, CA, USA" → "Tahoe City, CA, USA" failed with "Upstream service unavailable." Root cause: ORS's default snap radius couldn't reach a real road from the Pelias administrative-centroid point for "Ventura, CA" (it geocodes to a beach). Confirmed live before/after on the exact failing request. Body construction extracted to `buildOrsDirectionsBody` so this is now unit-tested without live network |
| D-037 | 2026-08-13 | Gold Run westbound restored as a live pin; the closed-facility test now derives its id list from `status:"closed"` in `scripts/sources/` instead of hard-coding it | The 08-12 Gold Run closure was transient and had already lapsed, but nothing would have told us: `scripts/check-rest-area-status.mjs` only compares SHIPPED pins against the feed, so a suppressed record is invisible to it and can never come back on its own. A hard-coded closed-id list made that worse — a reopening turned into a failing test rather than a restored pin. Derived-from-source keeps the invariant ("nothing marked closed ever ships") while letting reopenings flow through, and the added converse assertion ("everything marked open actually ships") catches stale suppressions. **Not fixed: the checker itself is still blind to closed records** — see Open Questions |
| D-043 | 2026-08-13 | Multi-stop (Clearcoat phase 6) is `planTrip()` called once per leg, completely unmodified — never given the concept of waypoints or legs | Resolves an apparent conflict between the restyle prompt's "src/planner/* DO NOT TOUCH, no exceptions" and its own "the planner treats a via as a leg boundary" — read literally these contradict. Confirmed by reading the actual planner (single-route-at-a-time, zero multi-leg concept) that the intended reading is orchestration OUTSIDE the planner: the Worker splits one ORS multi-waypoint response into per-leg geometry (`splitIntoLegs`), `state.js` calls `planTrip()` N times feeding each leg the previous leg's real arrival SOC. `src/planner/*` has a zero-line diff across the whole restyle session as a result. See the "Clearcoat restyle — session summary" above for full detail |
| D-044 | 2026-08-13 | Deployed the Worker's phase-6 changes (`/v1/route` now takes `waypoints[]`, not `from`/`to`) only after asking the user directly | `npm run worker:deploy` was blocked by the permission classifier as a production action; local `wrangler dev` hit a pre-existing wrangler-3.114 incompatibility unrelated to this session (see Human Tasks). Rather than skip live verification or work around the block, asked the user, who approved. Live-verified immediately after: caught and confirmed the client was correctly sending the new `{waypoints}` shape against a now-updated Worker (it had 502'd with the OLD from/to-shaped error against the not-yet-redeployed Worker moments earlier — exactly the regression this deploy-then-verify order exists to catch) |

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
| ~~Q9~~ | **Answered 2026-08-13** — user de-prioritized this; SOC/charger precision matters less than assumed, sleep availability was the real concern. Addressed via D-039, not a planner change | Post-gate hardening | Closed |
| ~~Q11~~ | **Answered 2026-08-13 — yes.** Built, see D-040 | Post-gate | Closed |
| Q12 | `dispersed-nf` is effectively summer-only (Eldorado NF closes dirt roads Jan 1 - Mar 31; both dispersed pins sit in Caldor burn scar; Echo Lake Sno-Park inverts and needs a permit Nov-May). Should the category be hidden or hard-labelled seasonally? | Post-gate | **User decision needed.** A pin that reads identically in February and August is the actual hazard |
| Q13 | Category-level `policyNote` (fire orders, stay limits, ordinance text) currently lives only in `scripts/sources/` where no driver will read it. Surface in-app? | Post-gate | No fallback picked |
| Q15 | BLM dispersed camping — user has now raised interest in this twice. Still blocked by the `blm` allowlist rejection in `build-sleep-geojson.mjs`. Worth a dedicated research pass (same rigor as `dispersed-nf`: access rules, seasonal closures, passenger-car reachability), not a quick add | Post-gate | Candidate for the charge-curve-style dedicated research session, see NEXT SESSION |
| ~~Q14~~ | `scripts/check-rest-area-status.mjs` only cross-checks SHIPPED pins against the live Caltrans feed, so a record suppressed as `status:"closed"` is invisible to it and can never come back automatically. Gold Run westbound sat wrongly suppressed for a day (found 2026-08-13 only because a human re-read the feed). Should the checker read `scripts/sources/*.json` directly and report BOTH directions of drift? | Post-gate | **Fixed 2026-08-13 (D-037)** |
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
- ~~Collapse the trip form once a trip is planned~~ — superseded by D-038: the
  map now has an expand/full-screen toggle at every width, and takes ~65% of a
  1440x900 desktop viewport (was ~24%). Collapsing the form on phones is still
  a possible refinement for the design pass
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

**The Clearcoat visual restyle (all 6 phases) is complete and deployed —
both the GitHub Pages frontend (push-on-commit via Actions) and the
Cloudflare Worker (deployed manually this session, D-044). DESIGN.md's
original six build-phase gates were already PASS before this restyle
started and are unaffected by it** (`src/planner/*` has a zero-line diff).

- **Model:** Sonnet for build/fixes/review follow-up. Switch with `/model`
  if starting fresh.
- **First task: read the independent review's outcome.** A multi-dimension
  review (DO-NOT-TOUCH compliance, spec fidelity, the build prompt's own
  self-check list, cross-file consistency) was launched via Workflow at the
  end of this session — check whether it landed and whether any findings
  still need fixing. If STATE.md's "Clearcoat restyle — session summary"
  section above still says "not yet done" under review status, the outcome
  wasn't folded back in before this file was last saved — check the git log
  for a follow-up commit after `2b8451c`/`5ed88ea`/`cbd845b` first.
- **Second, if the review is clean or already fixed:** verify the deployed
  Pages URL directly (not just localhost) — this session verified
  extensively against the local dev server pointed at the live Worker, but
  per CLAUDE.md ("Verify on the deployed Pages URL, not just localhost")
  the actual `mysimyg.github.io/wattnap/` build has not been separately
  re-checked post-restyle.
- **Then, real-hardware check (carried over from D-042, still open):**
  confirm the map renders on a real phone or desktop Chrome. This tool's
  browser has never been able to confirm map rendering either way, across
  two sessions now (D-021, D-042) — not urgent-feeling, but still the one
  thing no session has closed out with real confidence.
- **Then, if there's runway:** the pre-restyle backlog is unchanged and
  still open — Q15 (BLM dispersed camping research pass), charge-curve
  validation against a real Supercharger session (Human Tasks), and the
  deliberately-deferred restyle items (pin label tab, MapLibre symbol-layer
  pins, endpoint markers — see the session summary above).
- **Context needed:** `CLAUDE.md`, this file in full, `wattnap-spec.md`
  (the restyle's own spec, now checked into the repo root — read before
  touching any of the files it names), `DESIGN.md` §4.6.1, §4.6.2, §5.1.1,
  §8, §9.
- **Blockers:** none. Everything that needed account access or explicit
  sign-off (the Worker deploy) is done.
