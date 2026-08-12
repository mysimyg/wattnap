/**
 * The charge-window trip planner. Pure arithmetic: no network, no DOM, no
 * clock, no turf. Feed it frozen fixtures and it is fully reproducible.
 *
 * The idea it exists to serve: plan around a user-defined charge window
 * (arrive low, leave early, skip the taper) instead of the charge-to-80
 * default -- while paying honest per-stop overhead so shallow hopping does not
 * look free.
 */
import { effectiveCurve, chargeMinutes, socAtPowerThreshold, averageKw } from './curve.js'
import {
  buildEnergyProfile,
  energyBetween,
  ascentBetween,
  detourKwh,
  detourMinutes,
} from './energy.js'

const MAX_STOPS = 25
const MIN_ADVANCE_M = 1000 // never "advance" to a station essentially where we are
const ARRIVE_TOLERANCE = 3 // SOC points of slack around arriveSocTarget

/**
 * @param {object}   args
 * @param {object}   args.route     {distance_m, duration_s, geometry:[[lon,lat,ele]]}
 * @param {object[]} args.stations  annotated with distanceAlongRoute_m + detour_m
 * @param {object}   args.vehicle   from src/data/vehicles.json
 * @param {object}   args.strategy  from src/data/strategies.json
 * @param {number}   args.startSoc
 * @returns {object} Plan -- DESIGN.md §4.5
 */
export function planTrip({
  route,
  stations = [],
  vehicle,
  strategy,
  startSoc = 50,
  useUnknownKwStations = false,
}) {
  const warnings = []
  const profile = buildEnergyProfile(route.geometry, vehicle)
  const totalM = profile.totalM || route.distance_m || 0

  if (!profile.elevationAvailable) {
    warnings.push(
      'No elevation data in this route, so climbs are not modelled. Plans over passes will be optimistic.'
    )
  }

  const usable = vehicle.usableKwh
  const kwhToSoc = (kwh) => (100 * kwh) / usable
  const socToKwh = (soc) => (usable * soc) / 100

  const {
    arriveSocTarget = 12,
    departSocTarget = 50,
    taperCutoffKw = 100,
    reserveFloor = 8,
    overheadMinPerStop = 5,
  } = strategy

  // ---- candidate set -------------------------------------------------------
  const unknownKw = stations.filter((s) => s.maxKw == null || s.kwSource === 'unknown')
  let candidates = stations.filter(
    (s) => s.distanceAlongRoute_m != null && (s.maxKw != null || useUnknownKwStations)
  )
  if (unknownKw.length && !useUnknownKwStations) {
    warnings.push(
      unknownKw.length === 1
        ? '1 station in range had no reported power and was left out of the plan.'
        : `${unknownKw.length} stations in range had no reported power and were left out of the plan.`
    )
  }
  candidates = candidates
    .map((s) => ({ ...s, maxKw: s.maxKw ?? 50 }))
    .sort((a, b) => a.distanceAlongRoute_m - b.distanceAlongRoute_m)

  // ---- helpers -------------------------------------------------------------
  const legKwh = (fromM, toM) => energyBetween(profile, fromM, toM)
  const arriveSocAt = (fromM, fromSoc, s) =>
    fromSoc -
    kwhToSoc(legKwh(fromM, s.distanceAlongRoute_m) + detourKwh(s.detour_m ?? 0, vehicle))
  const socAtDestination = (fromM, fromSoc) => fromSoc - kwhToSoc(legKwh(fromM, totalM))

  const capFor = (s) => Math.min(s.maxKw, vehicle.maxAcceptedKw ?? s.maxKw)

  // ---- main loop -----------------------------------------------------------
  const stops = []
  let soc = startSoc
  let posM = 0
  let minSoc = startSoc
  let totalChargeMin = 0
  let totalDetourMin = 0

  for (let iter = 0; iter <= MAX_STOPS; iter++) {
    const destSoc = socAtDestination(posM, soc)
    if (destSoc >= reserveFloor) {
      minSoc = Math.min(minSoc, destSoc)
      return buildPlan({
        stops,
        route,
        profile,
        warnings,
        totalChargeMin,
        totalDetourMin,
        overheadMinPerStop,
        minSoc,
        startSoc,
        arriveSocAtDestination: destSoc,
      })
    }

    const ahead = candidates.filter((s) => s.distanceAlongRoute_m > posM + MIN_ADVANCE_M)
    const reachable = ahead
      .map((s) => ({ s, arriveSoc: arriveSocAt(posM, soc, s) }))
      .filter((x) => x.arriveSoc >= reserveFloor)

    if (!reachable.length) {
      const nextName = ahead.length ? ahead[0].name : 'the destination'
      return infeasible(
        `No charger is reachable before the battery would fall below the ${reserveFloor}% reserve. Next option is ${nextName}.`,
        { stops, route, profile, warnings, totalChargeMin, totalDetourMin, overheadMinPerStop, minSoc, startSoc }
      )
    }

    // Prefer the farthest stop that still arrives at or above the comfort
    // target; score nudges toward faster posts and away from long detours.
    const atOrAboveTarget = reachable.filter(
      (x) => x.arriveSoc >= arriveSocTarget - ARRIVE_TOLERANCE
    )
    let chosen
    if (atOrAboveTarget.length) {
      chosen = atOrAboveTarget.reduce((best, x) => (score(x) > score(best) ? x : best))
    } else {
      // Everything reachable arrives below the comfort target: take the safest
      // (highest arrival SOC) rather than pushing deeper into the reserve.
      chosen = reachable.reduce((best, x) => (x.arriveSoc > best.arriveSoc ? x : best))
      warnings.push(
        `Arriving at ${chosen.s.name} below the ${arriveSocTarget}% target -- the corridor has no closer option.`
      )
    }

    const station = chosen.s
    const arriveSoc = chosen.arriveSoc
    minSoc = Math.min(minSoc, arriveSoc)

    const cap = capFor(station)
    const eff = effectiveCurve(vehicle.chargeCurve, cap)

    // Departure: whichever comes first, the SOC target or the taper cutoff.
    // Guard (D-007): a post at or below the cutoff would trip it instantly and
    // the driver would leave having charged nothing.
    const taperApplies = taperCutoffKw > 0 && cap > taperCutoffKw
    const socTaper = taperApplies ? socAtPowerThreshold(eff, taperCutoffKw, arriveSoc) : 100
    let departSoc = Math.min(departSocTarget, socTaper)
    let overrideReason = null

    // ---- corridor override: look ahead to the next opportunity -------------
    const nextStation = candidates.find(
      (s) => s.distanceAlongRoute_m > station.distanceAlongRoute_m + MIN_ADVANCE_M
    )
    const nextM = Math.min(nextStation?.distanceAlongRoute_m ?? Infinity, totalM)
    const needKwh =
      legKwh(station.distanceAlongRoute_m, nextM) +
      (nextStation && nextM < totalM ? detourKwh(nextStation.detour_m ?? 0, vehicle) : 0)
    const neededSoc = kwhToSoc(needKwh) + reserveFloor

    let overrideDetail = null
    if (neededSoc > departSoc) {
      const ascent = ascentBetween(profile, station.distanceAlongRoute_m, nextM)
      const ascentKwh = ascent * profile.climbKwhPerM
      const ascentShare = needKwh > 0 ? ascentKwh / needKwh : 0
      // A binary label would be a lie on a leg that is both long and steep, so
      // carry the numbers the UI needs to explain itself honestly.
      overrideReason = ascentShare > 0.3 ? 'elevation' : 'sparse-corridor'
      overrideDetail = {
        nextGapMiles: Math.round((nextM - station.distanceAlongRoute_m) / 1609.344),
        ascentM: Math.round(ascent),
        ascentShare: Math.round(ascentShare * 100) / 100,
        nextStopName: nextStation && nextM < totalM ? nextStation.name : 'the destination',
        raisedFromSoc: round1(departSoc),
      }
      departSoc = neededSoc
    }

    departSoc = Math.max(departSoc, arriveSoc)

    if (departSoc > 100) {
      return infeasible(
        `The leg after ${station.name} needs more than a full battery (${departSoc.toFixed(0)}% required). No plan exists with this vehicle and corridor.`,
        { stops, route, profile, warnings, totalChargeMin, totalDetourMin, overheadMinPerStop, minSoc, startSoc }
      )
    }

    const mins = chargeMinutes(usable, eff, arriveSoc, departSoc)
    if (!isFinite(mins)) {
      return infeasible(`Charge time at ${station.name} could not be modelled.`, {
        stops, route, profile, warnings, totalChargeMin, totalDetourMin, overheadMinPerStop, minSoc, startSoc,
      })
    }
    const dMin = detourMinutes(station.detour_m ?? 0)

    stops.push({
      station,
      arriveSoc: round1(arriveSoc),
      departSoc: round1(departSoc),
      chargeMinutes: Math.round(mins),
      detourMinutes: Math.round(dMin),
      avgKw: Math.round(averageKw(usable, eff, arriveSoc, departSoc)),
      cappedByStation: cap < 250 && cap === station.maxKw,
      kwSource: station.kwSource ?? 'reported',
      overrideReason,
      overrideDetail,
    })

    totalChargeMin += mins
    totalDetourMin += dMin
    soc = departSoc
    posM = station.distanceAlongRoute_m
  }

  return infeasible(
    `Could not find a plan within ${MAX_STOPS} stops. The corridor may be too sparse for this charge window.`,
    { stops, route, profile, warnings, totalChargeMin, totalDetourMin, overheadMinPerStop: strategy.overheadMinPerStop ?? 5, minSoc, startSoc }
  )
}

/** Farther is better; fast posts earn a bonus, detours a penalty (km-equivalent). */
function score(x) {
  const km = x.s.distanceAlongRoute_m / 1000
  const kw = x.s.maxKw ?? 0
  const kwBonus = kw >= 250 ? 15 : kw >= 150 ? 7 : 0
  const detourPenalty = ((x.s.detour_m ?? 0) / 1000) * 2
  return km + kwBonus - detourPenalty
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function buildPlan(ctx) {
  const {
    stops, route, profile, warnings, totalChargeMin, totalDetourMin,
    overheadMinPerStop, minSoc, startSoc, arriveSocAtDestination,
  } = ctx
  const driveMinutes = (route.duration_s ?? 0) / 60
  const overheadMinutes = stops.length * overheadMinPerStop
  return {
    feasible: true,
    stops,
    summary: {
      driveMinutes: Math.round(driveMinutes),
      chargeMinutes: Math.round(totalChargeMin),
      overheadMinutes: Math.round(overheadMinutes),
      detourMinutes: Math.round(totalDetourMin),
      totalMinutes: Math.round(
        driveMinutes + totalChargeMin + overheadMinutes + totalDetourMin
      ),
      stopCount: stops.length,
      minSocReached: round1(minSoc),
      arriveSocAtDestination: round1(arriveSocAtDestination ?? minSoc),
      startSoc,
      distanceMiles: Math.round(profile.totalM / 1609.344),
      ascentM: Math.round(profile.ascentM),
      descentM: Math.round(profile.descentM),
      elevationAvailable: profile.elevationAvailable,
    },
    warnings,
  }
}

function infeasible(message, ctx) {
  const plan = buildPlan(ctx)
  return { ...plan, feasible: false, warnings: [...plan.warnings, message] }
}
