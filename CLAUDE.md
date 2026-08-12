# wattnap — operating manual

Read this file, `STATE.md`, and `DESIGN.md` at the start of every session.
`STATE.md` is the single source of truth for project state. Never reconstruct
state from memory.

## OPERATING STYLE

Plain English. Lead with the change, the result, or the blocker.
Short bullets over paragraphs. No filler, no praise, no restating
the request. Say when something is uncertain instead of guessing.
The user may later replace this block with their vault AI
Operating Instructions; keep everything else intact.

## GUARDRAILS

Propose before anything destructive. No force pushes. Conventional
commits, small, push at every gate minimum. Unknowns about APIs go
in DESIGN.md open questions, never guessed at in code. Zero
secrets in the repo, ever.

## SESSION PROTOCOL

- **Start:** read `CLAUDE.md`, `STATE.md`, `DESIGN.md`. State the current phase
  and the next action in one line, then proceed.
- **End, or when context feels ~70% consumed:** update `STATE.md` with a handoff
  block a cold session can resume from, commit, stop at a clean boundary.
  Never stop mid-feature.
- **After a crash:** the next session resumes from `STATE.md` and the last
  commit. No archaeology.

## PHASE GATES

- Every phase ends with the demo criterion listed in `DESIGN.md` → Phases.
- The reviewer or test agent verifies the gate. **Builders never certify their
  own work.**
- Verify on the deployed Pages URL, not just localhost.
- Record the gate pass in `STATE.md` with the date. Never advance past a failed
  gate.
- End every gate session summary with a **NEXT SESSION** block: which model to
  use, the first task, and a reminder to switch with `/model`.

## DECISION PROTOCOL

- Proceed without asking on anything reversible and in scope. Log it in
  `STATE.md` → Decisions Log.
- Stop and ask only for: scope changes, anything costing money or creating
  accounts, destructive operations, or conflicts with `DESIGN.md`.
- Batch questions. Do not drip them one at a time.
- New feature ideas mid-build go to `STATE.md` → Icebox, never into the code.

## AGENTS

Parallelize where separable:
- **Worker agent** — Cloudflare proxy, KV caching, origin allowlist.
- **Map frontend agent** — MapLibre, layers, controls.
- **Data curation agent** — GeoJSON build scripts for sleep spots.
- **Test agent** — corridor filtering and SOC math.
- **Reviewer agent** — owns every gate check and the phase 3 pressure test.

## MODEL PLAN

| Work | Model |
|---|---|
| Phase 0 design and approval | Opus |
| Phases 1, 2, 4, 5, 6 build | Sonnet, parallel agents |
| Phase 3 charging math | Opus main thread, Sonnet test agents |
| Pressure test swarms | Sonnet |
| Data wrangling, docs, lint | Haiku subagents |

## HARD RULES

- No application code until `DESIGN.md` is approved by the user.
- No API keys, tokens, or account IDs in the repo. Ever. Keys live in Cloudflare
  Worker secrets and GitHub Actions secrets only.
- `.dev.vars`, `.env*`, and `node_modules` stay gitignored.
