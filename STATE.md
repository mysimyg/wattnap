# wattnap — STATE.md

**Single source of truth across sessions. Read before acting. Update before stopping.**

Last updated: 2026-08-12

---

## Current Phase

**Phase 0 — DESIGN.md. Blocked on human approval.**
No application code may be written until the user approves `DESIGN.md`.

---

## Done

| Date | Item |
|---|---|
| 2026-08-12 | `CLAUDE.md` created — operating style, guardrails, session/decision protocols, model plan |
| 2026-08-12 | `DESIGN.md` drafted — architecture, verified API contracts, data schemas, planner algorithm, wireframe, gates, open questions, risks |
| 2026-08-12 | `STATE.md` created |
| 2026-08-12 | Git repo initialized, initial commit |
| 2026-08-12 | API verification: NREL domain migration, AFDC params/fields, OSRM demo terms |

## In Progress

Nothing. Awaiting the phase 0 approval gate.

## Next Actions

1. **User:** review `DESIGN.md`, answer open questions Q1–Q8 (batched, most have
   workable fallbacks), approve or send back edits.
2. **User:** clear the human tasks below.
3. On approval → phase 1 scaffold. Switch to Sonnet.

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
- [ ] **Answer Q5/Q6** in `DESIGN.md` — exact Model Y variant/year and typical
      departure SOC. Everything else has a fallback; the charge curve does not.

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

---

## Open Questions

Full table with fallbacks in `DESIGN.md` §9. Summary:

| # | Question | Needed by | Blocking? |
|---|---|---|---|
| Q1 | Basemap tile source (MapTiler key / Protomaps / OSM raster) | Phase 1 | No — fallback Protomaps |
| Q2 | AFDC `power_kw` coverage on the CA/NV corridor | Phase 2 | No — measure in phase 2 |
| Q3 | Connector defaults; does the car have a CCS adapter? | Phase 2 | No — default TESLA+CCS |
| Q4 | ORS free tier exact quotas (page is JS-rendered, unreadable) | Phase 1 | No — read at signup |
| Q5 | Model Y variant and year (pack size + charge curve) | Phase 3 | **Soft yes** — shipped curve is an estimate |
| Q6 | Typical departure SOC from home | Phase 3 | No — default 90 |
| Q7 | Include Level 2 for overnight sleep-spot charging? | Phase 4 | No — DC only |
| Q8 | Deploy target: project page or custom domain | Phase 1 | No — `/wattnap/` project page |

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

- **Model:** Opus if `DESIGN.md` needs revision; **Sonnet** once it is approved
  and phase 1 starts. Switch with `/model`.
- **First task:**
  - If approved → phase 1 scaffold: Vite + Preact + MapLibre skeleton, Worker
    with origin allowlist and KV cache, Pages deploy via Actions, Worker deploy.
    Gate: deployed URL renders a route between two typed addresses.
  - If not approved → revise `DESIGN.md` against the user's notes, re-gate.
- **Context needed:** `CLAUDE.md`, `STATE.md`, `DESIGN.md`. Nothing else exists yet.
- **Blockers to clear first:** human tasks above — NREL key, ORS key,
  `wrangler login`, GitHub repo. Phase 1 can scaffold without keys, but the
  gate cannot pass without routing.
