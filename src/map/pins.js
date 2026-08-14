/**
 * Inline-SVG pin elements for MapLibre DOM markers. No icon library, per
 * DESIGN.md constraint — every glyph here is hand-drawn markup.
 */

// ---------------------------------------------------------------------------
// Confidence ladder (wattnap-spec.md §5) — shared source of truth for pins.js
// AND the UI components (KwBadge, sleep list rows, the advisory meter), so
// "one rule, applied everywhere" doesn't drift into two rules by accident.
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

export function kwTier(station) {
  if (!station) return 'unknown'
  if (station.kwSource === 'unknown') return 'unknown'
  const kw = station.maxKw
  if (typeof kw !== 'number' || Number.isNaN(kw)) return 'unknown'
  if (kw >= 250) return 'high'
  if (kw >= 150) return 'mid'
  if (kw >= 50) return 'low'
  return 'unknown'
}

const TIER_COLOR = {
  high: '#4ade80',
  mid: '#38bdf8',
  low: '#a78bfa',
  unknown: '#8b93a1',
}
const TIER_SIZE = { high: 30, mid: 26, low: 22, unknown: 22 }

export function chargerPinElement(station, { selected = false } = {}) {
  const tier = kwTier(station)
  const color = TIER_COLOR[tier]
  const size = TIER_SIZE[tier] + (selected ? 4 : 0)
  const dashed = tier === 'unknown'
  const el = document.createElement('div')
  el.className = `wn-pin wn-pin--charger wn-pin--${tier}${selected ? ' wn-pin--selected' : ''}`
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `${station.name || 'Charger'}, ${station.maxKw ?? 'unknown'} kW`)
  el.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="13"
        fill="${color}" fill-opacity="${dashed ? 0.28 : 0.95}"
        stroke="${dashed ? color : '#0b0f14'}" stroke-width="${dashed ? 2 : 2}"
        ${dashed ? 'stroke-dasharray="3 3"' : ''} />
      <path d="M17.5 5 10 18h5.2l-1.4 9L22 13h-5.2l0.7-8z"
        fill="${dashed ? color : '#0b0f14'}" />
    </svg>`
  return el
}

export function sleepPinElement(category, { selected = false } = {}) {
  const color = (category && category.color) || '#f2c94c'
  const size = 24 + (selected ? 4 : 0)
  const el = document.createElement('div')
  el.className = `wn-pin wn-pin--sleep${selected ? ' wn-pin--selected' : ''}`
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', (category && category.label) || 'Sleep spot')
  el.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="13" fill="#0b0f14" fill-opacity="0.55" stroke="${color}" stroke-width="2" />
      <path d="M20.2 9.5a7 7 0 1 0 2.3 13 8.6 8.6 0 0 1-2.3-13z" fill="${color}" />
    </svg>`
  return el
}
