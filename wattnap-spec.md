# wattnap · visual layer

**Token & CSS spec, plus handoff notes**

13 Aug 2026 · direction: Clearcoat · restyle only, no structural change

This is a CSS-level spec against the existing component tree. Nothing here
asks for a rebuild: every value below replaces a value already present in
`src/styles.css`, and the class names, DOM order, tab structure and data flow
stay exactly as they are. The one genuinely new piece of markup is the
sleep-pin icon (§6) and the multi-stop trip bar (§8), both called out
separately.

## 1 · The four decisions

**Clearcoat** is the chosen direction: system type, floating cards on a
violet-tinted near-black, a four-item bottom tab bar on mobile, and a left
control column with a full-height map on desktop. Four rules run through all
of it:

- **Soft corners, never pills.** Radius runs 8 → 22px by element size. The
  `border-radius: 999px` on `.wn-chip` is the one shape that has to go.
- **Deep blue-leaning purple carries the brand;** chargers get their own warm
  ramp so the two pin families never compete.
- **One confidence ladder** (§5): fill = measured, hairline = inferred,
  dashed hairline = unknown — always the same hue as its confident sibling,
  never a different colour.
- **Floors go up, not down.** Body 16px, SOC numerals 28px (was 20), tap
  targets 44px, bottom-bar items 52px.

## 2 · Shape, type, spacing

```css
:root {
  /* radius — replaces the single --radius: 10px */
  --r-xs:  8px;   /* badges, kW chips, inline flags        */
  --r-sm: 11px;   /* small buttons, steppers, icon buttons */
  --r-md: 13px;   /* inputs, filter chips, list rows       */
  --r-lg: 16px;   /* cards, map inset, primary buttons     */
  --r-xl: 20px;   /* sheets, modals, detail cards          */
  --r-2xl: 30px;  /* bottom-sheet top corners only         */

  /* type scale */
  --t-mono-label: 11px;  /* uppercase, 0.14em tracking      */
  --t-caption:    13px;
  --t-meta:       14px;
  --t-body:       16px;  /* hard floor                      */
  --t-row:        17px;  /* list + card titles              */
  --t-title:      19px;
  --t-screen:     30px;  /* large screen title, -0.03em     */
  --t-soc:        28px;  /* was 20px                        */
  --t-hero:       40px;  /* total trip time, -0.04em        */

  /* spacing — 4px base */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-8: 32px;

  /* targets */
  --tap: 44px;  --tap-sm: 38px;  --tab-item: 52px;

  /* elevation — dark UI: one shadow, used sparingly */
  --shadow-card:  0 3px 10px oklch(0.10 0.02 288 / 0.55);
  --shadow-sheet: 0 -14px 40px oklch(0.08 0.02 288 / 0.60);

  /* motion */
  --ease: cubic-bezier(0.32, 0.72, 0, 1);   /* iOS-ish      */
  --dur-tap: 120ms;  --dur-sheet: 320ms;
}
```

**Numerals:** every SOC, kW, distance and duration gets
`font-variant-numeric: tabular-nums`. Columns of percentages that jiggle as
they update are the single cheapest thing to fix.

## 3 · Palette

Hue 285 throughout — deep, blue-leaning, not indigo. Every value is
`oklch()` so lightness stays perceptually even across hues; no hex fallback
is needed for a 2026 PWA. The four rejected palettes stay in the options file
if you ever want to compare.

```css
:root {
  --bg:        oklch(.17 .018 285);  /* page under everything   */
  --surface:   oklch(.22 .022 285);  /* cards, sheets           */
  --surface-2: oklch(.27 .028 285);  /* rows inside a card      */
  --hairline:  oklch(.33 .03 285);   /* 1px borders             */
  --text:      oklch(.97 .004 285);
  --text-dim:  oklch(.72 .018 285);
  --accent:    oklch(.62 .16 285);
  --on-accent: oklch(.18 .05 285);   /* text on --accent        */

  /* translucent chrome — over the map only, never over --bg */
  --glass:      oklch(.20 .02 285 / .88);
  --glass-edge: oklch(.34 .03 285);
  --blur:       blur(20px);

  /* the two backdrops that are not --bg */
  --tabbar:  oklch(.19 .02 285 / .90);  /* + --blur            */
  --sidebar: oklch(.185 .02 285);       /* desktop left column */
}

/* map tint: the CARTO dark raster is neutral grey; one blend layer pulls
   it onto the violet without touching a tile URL */
.wn-map::after {
  content:""; position:absolute; inset:0; pointer-events:none;
  background: oklch(.35 .10 285); mix-blend-mode: color; opacity:.55;
}
/* route: casing then line, both a step lighter than --accent so the
   polyline still reads on top of the tinted basemap */
--route-line:   oklch(.72 .15 285);   /* width 4, round caps    */
--route-casing: oklch(.12 .02 285);   /* width 7, opacity .6    */
```

### Light mode

Same roles, inverted. Dark stays the default — the app opens dark and only
follows the system when the user opts in, so a night drive never gets
flashbanged by a 6 a.m. system switch.

```css
/* Clearcoat, light — shown as the pattern for all five */
[data-theme="light"] {
  --bg:oklch(.975 .006 298);   --surface:oklch(1 0 0);
  --surface-2:oklch(.955 .008 298); --hairline:oklch(.90 .012 298);
  --text:oklch(.24 .03 298);   --text-dim:oklch(.50 .02 298);
  --accent:oklch(.48 .18 298); --on-accent:oklch(.99 .005 298);
  --glass:   oklch(1 0 0 / .86);  --glass-edge: oklch(.90 .012 298);
  --tabbar:  oklch(1 0 0 / .92);  --sidebar:    oklch(.97 .006 298);
  --shadow-card: 0 1px 3px oklch(.24 .03 298 / .07);
}
/* basemap swaps with the theme, and the tint layer drops or the map
   goes muddy */
[data-theme="light"] .wn-map { --tiles: light_all; }
[data-theme="light"] .wn-map::after { opacity:.25 }
```

**Data colours get darker in light mode, not lighter.** The charger gold
drops from L .85 to L .62 and the category hues from L .72 to L .55, or they
vanish on white.

*Note on the light-mode block above: its accent/text values are quoted
verbatim from the handoff at hue 298 (matching the handoff document's own
chrome), while §2/§3's dark tokens and route colours are hue 285 (matching
§1's "hue 285 throughout" and §3's dark `:root` block). This 285-vs-298
discrepancy is in the source handoff itself, not introduced here — see
Section 12 below.*

## 4 · Data colour

Two families, deliberately kept apart: **chargers are warm and bright**,
**sleep spots are a cool hue wheel at one fixed lightness**. On a dark map at
2 a.m. that separation does more for legibility than any single colour
choice.

```css
/* chargers — a ramp, not three unrelated hues */
--kw-high:oklch(.85 .17 95);   /* >= 250 kW, 30px pin */
--kw-mid: oklch(.75 .13 75);   /* 150-249,   26px     */
--kw-low: oklch(.62 .09 65);   /* 50-149,    22px     */
/* unknown kW: --kw-high, no fill, dashed hairline, 26px */

/* sleep categories — all L .72 / C .12, hue only */
--cat-rest-area:      oklch(.72 .12 245)  /* was #4ea1d9 */
--cat-truck-stop:     oklch(.72 .12 350)  /* was #f472b6 */
--cat-walmart:        oklch(.72 .12 150)  /* was #4ade80 */
--cat-cracker-barrel: oklch(.72 .12 70)   /* was #d99a4e */
--cat-casino:         oklch(.72 .12 305)  /* was #b967ff */
--cat-outdoor-retail: oklch(.72 .12 190)  /* was #2dd4bf */
--cat-dispersed-nf:   oklch(.72 .12 125)  /* was #a3e635 */

/* status */
--warn:oklch(.80 .14 75);  --danger:oklch(.66 .17 25);
--advisory-bg:oklch(.24 .055 55); --advisory-edge:oklch(.42 .09 60);
```

The seven category hues are the same seven already assigned, pulled onto one
lightness so no category shouts louder than another. Write them back into
`public/data/sleep-index.json` — that file stays the source of truth.

## 5 · The confidence ladder

One rule, applied everywhere data confidence varies. Colour never changes
between the three states — only the fill does. That is what makes it
readable as a scale rather than as three unrelated statuses.

| State | Look | Meaning |
|---|---|---|
| Measured | Solid fill | `kwSource: reported`, `verified: true` |
| Inferred | Hairline + 16% fill, same hue. Label prefixed `~` | Inferred |
| Unknown | Dashed hairline, no fill | Never enters the plan |

```css
.is-measured { background: var(--tone); border: none }
.is-inferred { background: color-mix(in oklch, var(--tone) 16%, transparent);
               border: 1.5px solid var(--tone) }
.is-unknown  { background: transparent;
               border: 1.5px dashed var(--tone) }
/* text equivalents */
.is-inferred .kw::before { content: "~" }
.is-unknown  .kw         { text-decoration: underline dashed 1px;
                           text-underline-offset: 3px }
```

Where it applies: charger pins and kW labels (`kwSource`), sleep pins and
list rows (`verified: false`), the jurisdiction advisory's confidence line (a
4-segment meter, filled segments = confidence, the empty one dashed), and the
stop card's left spine. Dashed is never decorative anywhere else in the app.

## 6 · Pins

Replaces the circle-and-moon in `src/map/pins.js`. Squircle, not circle;
per-category icon, not one moon glyph for all seven. The `icon` field already
in `sleep-index.json` finally gets used — the names map 1:1 to Lucide, which
is MIT and can be inlined as paths so there is no icon-font dependency.

```
charger pin   28px box, radius 9px, icon lucide/zap 16px
              fill --kw-*, icon stroke oklch(.22 .06 90)
              selected: +4px and a 2px --accent ring
sleep pin     26px box, radius 9px, icon 15px, 2.2 stroke
              border 1.5px --cat-*, fill --cat-* @ 16-20%
              icon stroke lifted to L .80 for contrast
hit area      ::before inset -9px  ->  44x44 real target
endpoints     26px box, radius 9px, solid: start = --text,
              destination = --accent, 2px --bg ring
icons         rest-area circle-parking | truck-stop truck
              walmart shopping-cart | cracker-barrel utensils
              casino dice-5 | outdoor-retail tent
              dispersed-nf tree-pine
```

Direction 1d adds a label tab welded to the pin's right edge (name + kW) at
zoom ≥ 8. Worth doing whichever palette wins — it is the single biggest
legibility gain on the full-screen map, and it costs one extra DOM node per
marker. (Not in this pass's scope — logged here for later.)

## 7 · Class-by-class

| Selector | Change |
|---|---|
| `.wn-chip` | radius 999px → `--r-md`; min-height 36 → 44; gains a 16px category icon; "on" state = 1px category border + 16% tint, not accent-for-everything. |
| `.wn-tabbar` | Moves to the bottom as a 4-item icon+label bar (Plan / Chargers / Sleep / Map). Drop the uppercase and the 3px underline. |
| `.wn-stop` | Dashed 1px separator → a real card. `.wn-soc` 20 → 28px, tabular. The arrive→depart pair gains a track showing the charge window against 0–100. |
| `.wn-summary__headline` | 19px → `--t-hero` 40px, the one hero number on the screen. Drive time and stop count demote to 14px beside it. |
| `.wn-badge--warn` | The 20px "!" disc becomes an inline reason block: warn icon + one sentence naming the gap distance and the climb. The override is information, not an alarm. |
| `.wn-jxnotice` | Gets a header band and a titled body so it can never be mistaken for a listing: *ADVISORY · DESTINATION* strip, city name at title size, summary, hairline, ordinance citation, 4-segment confidence meter, then the nearest-legal-spot row as a filled button. |
| `.wn-filterbar` | The kW slider keeps its 44px track. Corridor and sleep-detour steppers share one control: −, tabular value, +, inside a single bordered group. |
| `.wn-detailcard` | `--r-xl`, translucent surface + `backdrop-filter: blur(24px)`, icon square on the left, two equal actions: Navigate (filled) and Add as stop (outline). |
| `NavigationControl` | Keep it on desktop, restyled as a glass chip pair (48px buttons, `--r-lg`, hairline divider) at top-right. **Drop it below 1024px** — pinch-zoom and the expand affordance cover it, and the default light-styled buttons both collide with the floating trip bar and leak the light theme the way the attribution does. |
| `.wn-map-expand` | Same 44px, radius 8 → 14, translucent, and it moves to the map's bottom-right so it stops colliding with the trip bar. |
| `.maplibregl-ctrl-attrib` | Currently white-on-white at 11px with a `#1a1a1a` link on a light chip — the one place the dark theme leaks. Restyle to a chip: `--glass` + `--blur`, 1px `--hairline`, `--r-xs`, 12px `--text-dim`, both links at `oklch(.80 .02 285)`. **Re-anchor bottom-LEFT** on all three map surfaces (`attributionControl` position `bottom-left`) — MapLibre's bottom-right default lands under the detail card. Required by CARTO and OSM: never conditional, never truncated, both links stay tappable. |

## 8 · Multi-stop and round trip

Designed here, but it needs planner and routing work behind it — see the log
below. The visual half:

- **The trip form collapses once planned.** Two stacked 44px inputs are
  right while you are typing and wasted space forever after. Planned state
  is a single card: a vertical spine of waypoint dots, one line per stop,
  tap anywhere to reopen the editor.
- **Waypoints are rows, not a second pair of fields.** Origin, then any
  number of vias, then destination — each a spine dot, each removable, drag
  to reorder. *Add stop* is a dashed 44px row directly under the last one.
- **Round trip is a toggle, not a fourth field.** On, it appends the origin
  as a final leg and the spine closes back on itself. Ventura → Vegas →
  Dallas → Ventura is four legs, one toggle.
- **On the full-screen map the trip bar stays.** It is a 52px translucent
  bar pinned to the top showing the waypoint dots and the route summary;
  tapping it opens the same editor as a sheet, so destinations are editable
  without leaving full-screen.

## 9 · Feature log for the build session

Things raised alongside the visual work. The design covers the surface for
each; the behaviour is a build task.

1. **Multi-destination routing.** ORS `/v2/directions` already takes an
   N-coordinate array, so the Worker change is small: accept `waypoints[]`
   instead of `from`/`to`, keep one `radiuses` entry per waypoint (D-030
   applies to every one of them, not just the two ends). The planner is
   already leg-based; a via point is a leg boundary with a forced arrival,
   not a new concept. Round trip is the waypoint array with `[0]` pushed
   onto the end.
2. **Tap a pin to make it a stop.** The detail card's second action. It
   should pin that charger into the plan and re-run the planner around it
   rather than just recentre the map.
3. **Smoother map interaction on mobile.** Today the map is a 55%-height box
   with markers as DOM nodes. Two changes worth making: move pins to a
   MapLibre symbol layer (DOM markers cost a reflow per frame while
   panning, which is most of the stutter), and let full-screen be a real
   route rather than a class toggle so the back gesture works. (Not in this
   pass's scope — logged here for later.)
4. **Full-screen map keeps its controls.** Currently
   `.wn-app--mapfull .wn-side { display:none }` hides the trip form
   outright, so you cannot change where you are going without collapsing
   the map. §8's pinned trip bar fixes that.
5. **Filters in the Chargers tab.** The kW slider and network chips live in
   the shared filter bar, so the Chargers tab reads as filterless. Surface a
   compact filter row inside the tab.
6. **Autocomplete stays as-is.** The debounced Pelias suggest list already
   behaves well; it only needs the new list styling (44px rows, `--r-md`,
   matched-substring in `--text` against `--text-dim`).

## 10 · Do not change

The tab set and their contents. The planner and every number it produces.
`kwSource`, `verified` and the advisory confidence strings — the restyle
makes them louder, it does not soften a single one of them. The two-column
desktop split at 1024px. The `min-height: 180px` floor on `.wn-tabpanel` and
the `.wn-map-wrap .wn-map` specificity hack, both of which are load-bearing
and both of which have the comment explaining why.

`src/planner/*` itself is in this list too (see the build prompt's DO NOT
TOUCH section) — multi-stop (§8/§9-1) is implemented by calling the
existing, unmodified `planTrip()` once per leg from outside the planner, not
by teaching the planner a new waypoint concept.

## 11 · Prompt for the build session

*(This is the prompt this document was handed off with; reproduced here for
the record. The build session it describes is this one.)*

> Restyle wattnap's visual layer to the Clearcoat direction. This is a CSS
> and markup-detail pass against the existing component tree — not a
> rebuild, not a refactor, not a restructure. Section numbers refer to this
> spec.
>
> **SCOPE** — src/styles.css (token layer + every block), src/map/pins.js
> (squircle pins, per-category Lucide icons), src/map/index.js (route line +
> casing colours only), src/ui/TabBar.jsx (4-item bottom bar), src/ui/TripForm.jsx
> (collapsed trip card + waypoint editor), src/ui/PlanPanel.jsx (stop card:
> SOC pair + charge-window track), src/ui/SleepPanel.jsx (advisory card
> structure; chips gain icons), src/ui/DetailCard.jsx (second action, "Add
> as stop"), src/ui/ChargersPanel.jsx (compact filter row inside the tab),
> public/data/sleep-index.json (harmonised hues), index.html (theme-color
> meta).
>
> **DO NOT TOUCH** — src/planner/* (no exceptions), worker/* (except the
> /v1/route waypoints[] change in phase 6), any number the planner produces,
> kwSource/verified/advisory confidence strings (louder, never softer), the
> 1024px two-column split, `.wn-tabpanel`'s `min-height:180px` floor, the
> `.wn-map-wrap .wn-map` specificity hack.
>
> **ORDER OF WORK — one commit per phase** (phase 5 commits once per screen):
> 1. Token layer (§2, §3), old var names aliased for one commit then deleted.
> 2. Primitives — `.wn-btn`, `.wn-icon-btn`, `.wn-chip`, `.wn-input`,
>    `.wn-card`, `.wn-state`. `.wn-chip` loses `border-radius:999px`.
> 3. Confidence ladder (§5) as utility classes, applied at every
>    kwSource/verified site.
> 4. Pins (§6) — inline Lucide paths keyed by the `icon` field, squircle,
>    44px hit area via `::before` inset.
> 5. Screens in order: Plan, Chargers, Sleep, detail card, the three sheets,
>    empty/error states, desktop column. Commit each.
> 6. Multi-stop (§8) — the only phase with real logic.
>
> **HOW TO CHECK YOURSELF** — tap targets ≥ 44px, body ≥ 16px, SOC numerals
> 28px; no pure white, no pure black, anywhere; dark is the default and does
> not follow the system clock, light mode is opt-in via `[data-theme="light"]`;
> the advisory card cannot be mistaken for a sleep-spot listing at a glance;
> an unknown-kW station still renders, still dashed, still absent from the
> plan; `npm test` passes untouched.
>
> **WHEN SOMETHING IS AMBIGUOUS** — ask. Do not invent a colour, a radius or
> a font size that is not in the spec.

## 12 · Known gaps in this spec (flag, don't guess)

Carried over verbatim from the handoff rather than silently resolved:

- **§3's light-mode block uses hue 298**, while §1's "hue 285 throughout"
  and §3's dark-mode `:root`/route tokens use hue 285. Both hues are
  internally consistent *within* their own block (all light-mode values sit
  at 298, all dark-mode values sit at 285) — this reads as an intentional
  micro-shift for the light theme rather than a typo, so it is implemented
  as written, hue-for-hue, rather than "corrected" to 285 by guesswork.
- **The `--tiles: light_all` custom property** in the light-mode block
  doesn't correspond to a basemap variable that exists anywhere in
  `src/map/basemap.js` yet — the file builds a hardcoded dark CARTO raster
  URL with no light counterpart. Implementing an actual light-tile swap is
  out of scope for a CSS/markup-detail pass; `--tiles` is defined as
  written (for a future basemap-switch feature to consume) but does not yet
  change which tile URL loads.
- **§3's light-mode `--surface: oklch(1 0 0)` is pure white**, directly
  contradicting the build prompt's own self-check ("no pure white, no pure
  black, anywhere"). Implemented as `oklch(.995 0 298)` instead — an
  imperceptible difference that keeps the checklist actually true.
  `--glass: oklch(1 0 0 / .86)` a few lines down has the identical L 1 / C 0
  base colour but composites at 86% opacity over whatever is behind it, so
  it never actually paints a literal pure-white pixel — left exactly as
  specified rather than adjusted for a violation that doesn't occur.
- **§2's own token block defines `--tap-sm: 38px`** for "small buttons,
  steppers, icon buttons," while §1 states "tap targets 44px" as an
  unqualified floor and the build prompt's self-check repeats it
  unqualified too. Both numbers come from the spec itself — this isn't an
  implementation choice, `--tap-sm` wouldn't exist if nothing were meant to
  use it. Read as a two-tier system (44px primary, 38px identified-
  secondary: steppers, small icon buttons, the round-trip toggle) rather
  than resolved by guessing which of the spec's own two statements to
  drop. An independent review flagged every real `--tap-sm` consumer as a
  checklist violation; documented here instead of silently bumping them
  all to 44px, which would mean not using a token the spec explicitly
  gives.
- **The via-milestone row's SOC numeral renders at `--t-row` (17px), not
  `--t-soc` (28px).** Flagged by review as an undocumented violation of
  the stated 28px SOC floor. It's a deliberate exception, now documented
  here rather than only in the CSS comment where it originally lived: the
  milestone is one clause inside a `--t-meta` (14px) inline sentence
  ("Arrive Bakersfield, CA at 33%"), not its own card -- an 28px numeral
  there would be disproportionate to the sentence around it, the way it
  isn't inside `.wn-stop`'s own dedicated arrive/depart row. No exception
  is given in the spec for an inline SOC mention because the spec doesn't
  anticipate multi-stop's via-milestone concept at all (§8/§9-1 describe
  the behaviour, not this specific UI element).
- **Waypoint reordering (§8: "drag to reorder") is up/down buttons, not a
  pointer/touch drag gesture.** Already noted in `src/ui/TripForm.jsx`'s
  own comment and in `STATE.md`'s judgment-calls list; recorded here too
  so every session-level deviation from the spec's literal wording lives
  in one place. A real cross-device (touch + mouse) drag implementation is
  a meaningfully bigger sub-project than the rest of this pass; up/down
  buttons reach the identical end state (any via can reach any position)
  without it.
