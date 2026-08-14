/**
 * Inline-SVG squircle pin elements for MapLibre DOM markers — wattnap-spec.md
 * §6. No icon library: the seven Lucide sleep-category glyphs plus the
 * charger bolt are inlined as raw paths (source: MIT-licensed Lucide,
 * https://lucide.dev), kept verbatim so a future icon update is a plain
 * diff against upstream rather than a redraw.
 */

// ---------------------------------------------------------------------------
// Confidence ladder (wattnap-spec.md §5) — shared source of truth for pins.js
// AND the UI components (KwBadge, sleep list rows, the advisory meter), so
// "one rule, applied everywhere" doesn't drift into two rules by accident.
// Pins express it via SVG fill-opacity/stroke-dasharray rather than the
// .is-measured/.is-inferred/.is-unknown CSS classes those DOM sites use --
// border/background are an HTML box-model concept that doesn't translate to
// an SVG marker, so the pin builders below implement the same three states
// in SVG terms instead of consuming those classes directly.
// ---------------------------------------------------------------------------

/** kwSource -> which of the three ladder states a charger reads as. */
export function kwConfidenceClass(kwSource) {
  if (kwSource === 'unknown') return 'is-unknown'
  if (kwSource === 'inferred') return 'is-inferred'
  return 'is-measured'
}

/**
 * Power-band tone, independent of confidence — an inferred 150kW station
 * and a reported 150kW station share --kw-mid, they just render it
 * differently (fill vs hairline). An unknown-kW station gets --kw-high per
 * wattnap-spec.md §6: dashed and colourless until proven, never presumed
 * weak either.
 */
export function kwPowerTier(station) {
  if (!station || station.kwSource === 'unknown') return 'high'
  const kw = station.maxKw
  if (typeof kw !== 'number' || Number.isNaN(kw)) return 'high'
  if (kw >= 250) return 'high'
  if (kw >= 150) return 'mid'
  return 'low'
}

export function kwToneVar(station) {
  return `var(--kw-${kwPowerTier(station)})`
}

/** Sleep spots only carry a boolean `verified` -- no inferred middle state. */
export function sleepConfidenceClass(verified) {
  return verified === false ? 'is-unknown' : 'is-measured'
}

// ---------------------------------------------------------------------------
// Icons — inlined from Lucide (24x24 viewBox, stroke-based: fill="none",
// stroke="currentColor" in the source). Names match the `icon` field in
// public/data/sleep-index.json 1:1 (wattnap-spec.md §6 renamed the rest-area
// icon from Lucide's old "parking-circle" to its current "circle-parking" --
// see the phase 4 commit for the matching sleep-index.json update).
// ---------------------------------------------------------------------------

const NATIVE_VB = 24 // every Lucide icon's native viewBox size

export const ICONS = {
  zap: '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',
  'circle-parking': '<circle cx="12" cy="12" r="10"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  'shopping-cart':
    '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  utensils:
    '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  'dice-5':
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/>',
  tent: '<path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/>',
  'tree-pine':
    '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/>',
}

/** Centers a native-24 Lucide glyph at `size`px inside a `boxSize`px box. */
function iconGroup(name, { boxSize, size, stroke, strokeWidth = 2 }) {
  const inner = ICONS[name] || ICONS.tent
  const scale = size / NATIVE_VB
  const offset = (boxSize - size) / 2
  // stroke-width is set in the glyph's own pre-scale coordinate space, so
  // dividing by `scale` here is what makes the RENDERED stroke come out at
  // `strokeWidth`px regardless of how much the icon itself is scaled down.
  const nativeStroke = (strokeWidth / scale).toFixed(2)
  return `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="${nativeStroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`
}

const RADIUS = 9 // wattnap-spec.md §6: "26/28px box, radius 9px" for every pin type

/** The squircle itself -- inset by half the stroke so it isn't edge-clipped. */
function squircleRect({ boxSize, fill, stroke, strokeWidth = 0, dashed = false }) {
  const inset = strokeWidth / 2
  const w = boxSize - inset * 2
  return `<rect x="${inset}" y="${inset}" width="${w}" height="${w}" rx="${RADIUS}" ry="${RADIUS}" fill="${fill}"${
    stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ''
  }${dashed ? ' stroke-dasharray="3 3"' : ''} />`
}

/** wattnap-spec.md §6: "selected: +4px and a 2px --accent ring." */
function selectedRing(totalBox) {
  const strokeWidth = 2
  const inset = strokeWidth / 2
  const w = totalBox - inset * 2
  return `<rect x="${inset}" y="${inset}" width="${w}" height="${w}" rx="${RADIUS + 2}" ry="${RADIUS + 2}" fill="none" stroke="var(--accent)" stroke-width="${strokeWidth}" />`
}

export function chargerPinElement(station, { selected = false } = {}) {
  const confClass = kwConfidenceClass(station && station.kwSource)
  const toneVar = kwToneVar(station)
  const isUnknown = confClass === 'is-unknown'
  const isInferred = confClass === 'is-inferred'
  // "unknown kW: --kw-high, no fill, dashed hairline, 26px" -- one size
  // smaller than the 28px measured/inferred box, per wattnap-spec.md §6.
  const baseBox = isUnknown ? 26 : 28
  const totalBox = baseBox + (selected ? 4 : 0)
  const centerOffset = (totalBox - baseBox) / 2

  let fill, stroke, strokeWidth, dashed
  if (isUnknown) {
    fill = 'none'
    stroke = toneVar
    strokeWidth = 1.5
    dashed = true
  } else if (isInferred) {
    fill = `color-mix(in oklch, ${toneVar} 16%, transparent)` // ladder §5's exact inferred figure
    stroke = toneVar
    strokeWidth = 1.5
    dashed = false
  } else {
    fill = toneVar
    stroke = 'none'
    strokeWidth = 0
    dashed = false
  }

  const squircle = squircleRect({ boxSize: baseBox, fill, stroke, strokeWidth, dashed })
  const icon = iconGroup('zap', { boxSize: baseBox, size: 16, stroke: 'oklch(.22 .06 90)' })
  const ring = selected ? selectedRing(totalBox) : ''
  const kwLabel = station && station.kwSource === 'unknown' ? 'kW unknown' : `${station && station.maxKw} kW`

  const el = document.createElement('div')
  el.className = `wn-pin wn-pin--charger ${confClass}${selected ? ' wn-pin--selected' : ''}`
  el.style.width = `${totalBox}px`
  el.style.height = `${totalBox}px`
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `${(station && station.name) || 'Charger'}, ${kwLabel}`)
  el.innerHTML = `
    <svg width="${totalBox}" height="${totalBox}" viewBox="0 0 ${totalBox} ${totalBox}" xmlns="http://www.w3.org/2000/svg">
      ${ring}
      <g transform="translate(${centerOffset} ${centerOffset})">
        ${squircle}
        ${icon}
      </g>
    </svg>`
  return el
}

/**
 * @param {object} category  the sleep-index.json category entry (label, icon, category slug)
 * @param {boolean} verified the specific feature's own `verified` flag -- confidence is
 *   per-spot, not per-category, so this can't be read off `category` alone.
 */
export function sleepPinElement(category, verified, { selected = false } = {}) {
  const slug = (category && category.category) || 'rest-area'
  const toneVar = `var(--cat-${slug})`
  const confClass = sleepConfidenceClass(verified)
  const isUnknown = confClass === 'is-unknown'
  const baseBox = 26
  const totalBox = baseBox + (selected ? 4 : 0)
  const centerOffset = (totalBox - baseBox) / 2
  const iconName = (category && category.icon) || 'tent'

  // "border 1.5px --cat-*, fill --cat-* @ 16-20%" -- always bordered, unlike
  // the charger's solid-fill measured state; only the fill and the dash
  // (unverified) change. 18% sits in the given 16-20% range; the spec
  // doesn't pin an exact figure.
  const fill = isUnknown ? 'none' : `color-mix(in oklch, ${toneVar} 18%, transparent)`
  const squircle = squircleRect({ boxSize: baseBox, fill, stroke: toneVar, strokeWidth: 1.5, dashed: isUnknown })
  // "icon stroke lifted to L .80 for contrast" -- approximated as a mix
  // toward white rather than a hand-computed per-hue oklch value, so it
  // stays correct if --cat-* is ever retuned (light mode already retunes
  // it) instead of silently drifting from a hardcoded snapshot.
  const icon = iconGroup(iconName, {
    boxSize: baseBox,
    size: 15,
    stroke: `color-mix(in oklch, ${toneVar} 70%, white)`,
    strokeWidth: 2.2,
  })
  const ring = selected ? selectedRing(totalBox) : ''

  const el = document.createElement('div')
  el.className = `wn-pin wn-pin--sleep ${confClass}${selected ? ' wn-pin--selected' : ''}`
  el.style.width = `${totalBox}px`
  el.style.height = `${totalBox}px`
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', (category && category.label) || 'Sleep spot')
  el.innerHTML = `
    <svg width="${totalBox}" height="${totalBox}" viewBox="0 0 ${totalBox} ${totalBox}" xmlns="http://www.w3.org/2000/svg">
      ${ring}
      <g transform="translate(${centerOffset} ${centerOffset})">
        ${squircle}
        ${icon}
      </g>
    </svg>`
  return el
}
