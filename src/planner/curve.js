/**
 * Charge-curve math. Pure: no I/O, no DOM, no clock.
 *
 * A charge curve is a piecewise-linear map of SOC% -> kW, measured at a post
 * that can deliver more power than the car accepts. Real charging is the
 * minimum of what the car wants and what the post can give, so every curve is
 * clipped by a station cap before it is used.
 */

/** Linear interpolation of the raw curve at a given SOC. */
export function powerAtSoc(curve, soc) {
  if (soc <= curve[0][0]) return curve[0][1]
  const last = curve[curve.length - 1]
  if (soc >= last[0]) return last[1]
  for (let i = 0; i < curve.length - 1; i++) {
    const [s0, p0] = curve[i]
    const [s1, p1] = curve[i + 1]
    if (soc >= s0 && soc <= s1) {
      if (s1 === s0) return p1
      return p0 + ((p1 - p0) * (soc - s0)) / (s1 - s0)
    }
  }
  return last[1]
}

/**
 * Clip a curve to a station's max power, inserting breakpoints where the curve
 * crosses the cap so the result stays exactly piecewise linear.
 */
export function effectiveCurve(curve, capKw) {
  const cap = Math.max(0, capKw)
  const out = []
  for (let i = 0; i < curve.length; i++) {
    const [s0, p0] = curve[i]
    out.push([s0, Math.min(p0, cap)])
    const next = curve[i + 1]
    if (!next) continue
    const [s1, p1] = next
    const above0 = p0 > cap
    const above1 = p1 > cap
    if (above0 !== above1 && p1 !== p0) {
      const sx = s0 + ((cap - p0) * (s1 - s0)) / (p1 - p0)
      if (sx > s0 && sx < s1) out.push([sx, cap])
    }
  }
  return out
}

/**
 * Minutes to move from socFrom to socTo on an already-capped curve.
 *
 * Closed form, not a simulation loop. Over one linear piece where power runs
 * Pa -> Pb while SOC runs a -> b:
 *
 *   hours = E_per_soc * (b - a) / (Pb - Pa) * ln(Pb / Pa)     (Pa != Pb)
 *   hours = E_per_soc * (b - a) / Pa                          (Pa == Pb)
 *
 * where E_per_soc = usableKwh / 100.
 */
export function chargeMinutes(usableKwh, effCurve, socFrom, socTo) {
  if (socTo <= socFrom) return 0
  const ePerSoc = usableKwh / 100
  let hours = 0
  for (let i = 0; i < effCurve.length - 1; i++) {
    const [s0, p0] = effCurve[i]
    const [s1, p1] = effCurve[i + 1]
    const a = Math.max(socFrom, s0)
    const b = Math.min(socTo, s1)
    if (b <= a || s1 === s0) continue
    const t = (x) => (x - s0) / (s1 - s0)
    const pa = p0 + (p1 - p0) * t(a)
    const pb = p0 + (p1 - p0) * t(b)
    if (pa <= 0 || pb <= 0) return Infinity
    hours +=
      Math.abs(pb - pa) < 1e-9
        ? (ePerSoc * (b - a)) / pa
        : ((ePerSoc * (b - a)) / (pb - pa)) * Math.log(pb / pa)
  }
  return hours * 60
}

/**
 * The SOC at or after `fromSoc` where delivered power first falls to
 * `thresholdKw`. Returns 100 if it never does.
 *
 * Guard: a station whose max power is already at or below the threshold would
 * trip the cutoff immediately and the driver would leave having charged
 * nothing. Callers must skip the taper rule in that case (see planner.js).
 */
export function socAtPowerThreshold(effCurve, thresholdKw, fromSoc = 0) {
  if (thresholdKw <= 0) return 100
  for (let i = 0; i < effCurve.length - 1; i++) {
    const [s0, p0] = effCurve[i]
    const [s1, p1] = effCurve[i + 1]
    if (s1 <= fromSoc) continue
    const a = Math.max(fromSoc, s0)
    if (s1 === s0) continue
    const pa = p0 + ((p1 - p0) * (a - s0)) / (s1 - s0)
    if (pa <= thresholdKw && a >= fromSoc) return a
    if (p1 <= thresholdKw && p0 !== p1) {
      const sx = s0 + ((thresholdKw - p0) * (s1 - s0)) / (p1 - p0)
      if (sx >= a && sx <= s1) return sx
    }
  }
  return 100
}

/** Average kW delivered across a window, derived from the integral. */
export function averageKw(usableKwh, effCurve, socFrom, socTo) {
  const mins = chargeMinutes(usableKwh, effCurve, socFrom, socTo)
  if (!isFinite(mins) || mins <= 0) return 0
  const kwh = (usableKwh * (socTo - socFrom)) / 100
  return kwh / (mins / 60)
}
