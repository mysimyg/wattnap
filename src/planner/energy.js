/**
 * Elevation-aware energy model. Pure: no I/O, no DOM, no clock.
 *
 * Ascent and descent are accumulated SEPARATELY, never netted. You do not get
 * the climb back at 100% -- regen returns roughly 70% of it. Netting elevation
 * is the mistake that puts a driver on the shoulder at Echo Summit.
 */

const EARTH_R = 6371008.8
const M_PER_MILE = 1609.344
// kWh of potential energy per kg per metre climbed: 9.81 / 3.6e6
const G_OVER_KWH = 9.81 / 3.6e6

export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

/**
 * Smooth an elevation series with a centred moving average.
 *
 * Raw GPS/DEM elevation is noisy, and noise inflates cumulative ascent badly --
 * unsmoothed profiles routinely report double the real climb, which would make
 * every plan needlessly conservative. Smoothing plus the dead-band in
 * buildEnergyProfile is what keeps the ascent total honest.
 */
export function smoothElevations(eles, window = 5) {
  if (eles.length < window) return eles.slice()
  const half = Math.floor(window / 2)
  const out = new Array(eles.length)
  for (let i = 0; i < eles.length; i++) {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(eles.length - 1, i + half); j++) {
      if (eles[j] == null || !isFinite(eles[j])) continue
      sum += eles[j]
      n++
    }
    out[i] = n ? sum / n : null
  }
  return out
}

/**
 * Cumulative distance / energy / ascent / descent along a route geometry.
 *
 * geometry: [[lon, lat, elevation_m|null], ...]
 * Returns flat arrays indexed by vertex so any sub-range can be interpolated.
 */
export function buildEnergyProfile(geometry, vehicle, opts = {}) {
  const deadBandM = opts.deadBandM ?? 2
  const smoothWindow = opts.smoothWindow ?? 5
  const n = geometry.length
  const hasEle =
    n > 0 && geometry.some((p) => p.length > 2 && p[2] != null && isFinite(p[2]))
  const eles = hasEle
    ? smoothElevations(geometry.map((p) => (p.length > 2 ? p[2] : null)), smoothWindow)
    : null

  const flatKwhPerM = vehicle.consumptionWhPerMile / 1000 / M_PER_MILE
  const climbKwhPerM =
    (vehicle.massKg * G_OVER_KWH) / (vehicle.drivetrainEfficiency ?? 0.85)
  const descentKwhPerM = vehicle.massKg * G_OVER_KWH * (vehicle.regenEfficiency ?? 0.7)

  const cumM = new Float64Array(n)
  const cumKwh = new Float64Array(n)
  const cumAscent = new Float64Array(n)
  const cumDescent = new Float64Array(n)

  let carriedEle = hasEle ? eles[0] : null
  for (let i = 1; i < n; i++) {
    const segM = haversineMeters(geometry[i - 1], geometry[i])
    let ascent = 0
    let descent = 0
    if (hasEle && eles[i] != null && carriedEle != null) {
      const dz = eles[i] - carriedEle
      // Dead-band: only commit an elevation change once it exceeds the noise
      // floor. Anything smaller is carried forward, not discarded, so a long
      // gentle grade still accumulates correctly.
      if (Math.abs(dz) >= deadBandM) {
        if (dz > 0) ascent = dz
        else descent = -dz
        carriedEle = eles[i]
      }
    } else if (hasEle && eles[i] != null && carriedEle == null) {
      carriedEle = eles[i]
    }
    const kwh = segM * flatKwhPerM + ascent * climbKwhPerM - descent * descentKwhPerM
    cumM[i] = cumM[i - 1] + segM
    cumKwh[i] = cumKwh[i - 1] + kwh
    cumAscent[i] = cumAscent[i - 1] + ascent
    cumDescent[i] = cumDescent[i - 1] + descent
  }

  return {
    cumM,
    cumKwh,
    cumAscent,
    cumDescent,
    totalM: n ? cumM[n - 1] : 0,
    ascentM: n ? cumAscent[n - 1] : 0,
    descentM: n ? cumDescent[n - 1] : 0,
    elevationAvailable: hasEle,
    flatKwhPerM,
    climbKwhPerM,
    descentKwhPerM,
  }
}

/** Linear interpolation of any cumulative array at a distance along the route. */
function interpAt(profile, arr, m) {
  const { cumM } = profile
  const n = cumM.length
  if (n === 0) return 0
  if (m <= 0) return arr[0]
  if (m >= cumM[n - 1]) return arr[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumM[mid] <= m) lo = mid
    else hi = mid
  }
  const span = cumM[hi] - cumM[lo]
  if (span <= 0) return arr[lo]
  const t = (m - cumM[lo]) / span
  return arr[lo] + (arr[hi] - arr[lo]) * t
}

export function energyBetween(profile, m0, m1) {
  return interpAt(profile, profile.cumKwh, m1) - interpAt(profile, profile.cumKwh, m0)
}

export function ascentBetween(profile, m0, m1) {
  return interpAt(profile, profile.cumAscent, m1) - interpAt(profile, profile.cumAscent, m0)
}

export function metersToMiles(m) {
  return m / M_PER_MILE
}

/** Flat-consumption energy for an off-route detour, in kWh. */
export function detourKwh(detourMeters, vehicle) {
  return (detourMeters * 2 * vehicle.consumptionWhPerMile) / 1000 / M_PER_MILE
}

/** Detour time in minutes, assuming surface-street speed. */
export function detourMinutes(detourMeters, mph = 35) {
  const metersPerMinute = (mph * M_PER_MILE) / 60
  return (detourMeters * 2) / metersPerMinute
}
