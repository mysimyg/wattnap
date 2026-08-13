import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  planTrip,
  annotateStations,
  buildEnergyProfile,
  effectiveCurve,
  chargeMinutes,
  powerAtSoc,
  socAtPowerThreshold,
} from '../src/planner/index.js'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)))
const vehicles = read('../src/data/vehicles.json')
const strategiesFile = read('../src/data/strategies.json')
const VEHICLE = vehicles.vehicles.find((v) => v.id === vehicles.default)
const STRATEGIES = strategiesFile.strategies
const STATIONS = read('./fixtures/stations-us395.json').stations
const ROUTES = {
  tahoe: read('./fixtures/route-ventura-southlaketahoe.json'),
  reno: read('./fixtures/route-ventura-reno.json'),
}

const MILES = 1609.344
/** What the app actually does by default: 250 kW+ within a 5-mile corridor. */
function corridor(route, { minKw = 250, maxDetourMi = 5 } = {}) {
  return annotateStations(STATIONS, route.geometry).filter(
    (s) => s.detour_m / MILES <= maxDetourMi && (s.maxKw ?? 0) >= minKw
  )
}

// ---------------------------------------------------------------- curve ----
describe('charge curve', () => {
  const eff250 = effectiveCurve(VEHICLE.chargeCurve, 250)

  it('closed-form integral matches numeric integration', () => {
    // The closed form is the whole reason charge time is fast and exact.
    // If it ever drifts from a brute-force Riemann sum, it is wrong.
    const numeric = (a, b, steps = 200000) => {
      const ePerSoc = VEHICLE.usableKwh / 100
      const h = (b - a) / steps
      let hours = 0
      for (let i = 0; i < steps; i++) {
        const mid = a + h * (i + 0.5)
        hours += (ePerSoc * h) / powerAtSoc(eff250, mid)
      }
      return hours * 60
    }
    for (const [a, b] of [[12, 50], [10, 80], [5, 95], [40, 41], [0, 100]]) {
      const closed = chargeMinutes(VEHICLE.usableKwh, eff250, a, b)
      expect(Math.abs(closed - numeric(a, b))).toBeLessThan(0.05)
    }
  })

  it('caps at the station power and inserts the crossing breakpoint', () => {
    const eff150 = effectiveCurve(VEHICLE.chargeCurve, 150)
    for (let soc = 0; soc <= 100; soc += 0.5) {
      expect(powerAtSoc(eff150, soc)).toBeLessThanOrEqual(150 + 1e-9)
    }
    // Slower post => strictly more time for the same window.
    expect(chargeMinutes(VEHICLE.usableKwh, eff150, 12, 50)).toBeGreaterThan(
      chargeMinutes(VEHICLE.usableKwh, eff250, 12, 50)
    )
  })

  it('charging longer always takes longer, and zero-width windows cost nothing', () => {
    let prev = 0
    for (let soc = 13; soc <= 90; soc++) {
      const t = chargeMinutes(VEHICLE.usableKwh, eff250, 12, soc)
      expect(t).toBeGreaterThan(prev)
      prev = t
    }
    expect(chargeMinutes(VEHICLE.usableKwh, eff250, 50, 50)).toBe(0)
    expect(chargeMinutes(VEHICLE.usableKwh, eff250, 50, 40)).toBe(0)
  })

  it('D-007 guard: a post at or below the taper cutoff must not trip it instantly', () => {
    // A 100 kW post with a 100 kW cutoff would otherwise "taper" at 0% SOC and
    // the driver would depart having charged nothing.
    const eff100 = effectiveCurve(VEHICLE.chargeCurve, 100)
    const cap = 100
    const cutoff = 100
    const taperApplies = cutoff > 0 && cap > cutoff
    expect(taperApplies).toBe(false)
    // And the planner honours that: it charges to the SOC target instead.
    const slow = STATIONS.map((s) => ({ ...s, maxKw: 100, kwSource: 'reported' }))
    const ann = annotateStations(slow, ROUTES.tahoe.route.geometry).filter(
      (s) => s.detour_m / MILES <= 5
    )
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: ann,
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    for (const stop of plan.stops) {
      expect(stop.chargeMinutes).toBeGreaterThan(0)
      expect(stop.departSoc).toBeGreaterThan(stop.arriveSoc)
    }
    expect(socAtPowerThreshold(eff100, 100, 12)).toBeGreaterThan(0)
  })
})

// --------------------------------------------------------------- energy ----
describe('energy model', () => {
  it('sums ascent and descent separately rather than netting them', () => {
    // Up 1000 m then down 1000 m: net zero, but it costs real energy.
    const geom = []
    for (let i = 0; i <= 50; i++) geom.push([-119 + i * 0.01, 38, i * 20])
    for (let i = 1; i <= 50; i++) geom.push([-118.5 + i * 0.01, 38, 1000 - i * 20])
    const p = buildEnergyProfile(geom, VEHICLE)
    expect(p.ascentM).toBeGreaterThan(950)
    expect(p.descentM).toBeGreaterThan(950)
    const withHills = p.cumKwh[p.cumKwh.length - 1]
    const flat = buildEnergyProfile(
      geom.map(([lon, lat]) => [lon, lat, 0]),
      VEHICLE
    )
    expect(withHills).toBeGreaterThan(flat.cumKwh[flat.cumKwh.length - 1])
  })

  it('the dead band suppresses elevation noise without losing a real grade', () => {
    const noisy = []
    for (let i = 0; i <= 200; i++) {
      noisy.push([-119 + i * 0.005, 38, 500 + (i % 2 === 0 ? 0.6 : -0.6)])
    }
    expect(buildEnergyProfile(noisy, VEHICLE).ascentM).toBeLessThan(5)

    const grade = []
    for (let i = 0; i <= 200; i++) grade.push([-119 + i * 0.005, 38, 500 + i * 5])
    expect(buildEnergyProfile(grade, VEHICLE).ascentM).toBeGreaterThan(950)
  })

  it('falls back to a flat model and warns when elevation is missing', () => {
    const flatRoute = {
      ...ROUTES.tahoe.route,
      geometry: ROUTES.tahoe.route.geometry.map(([lon, lat]) => [lon, lat, null]),
    }
    const plan = planTrip({
      route: flatRoute,
      stations: corridor(flatRoute),
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    expect(plan.summary.elevationAvailable).toBe(false)
    expect(plan.warnings.join(' ')).toMatch(/elevation/i)
  })

  it('the Ventura to Tahoe corridor really does climb enough to matter', () => {
    const p = buildEnergyProfile(ROUTES.tahoe.route.geometry, VEHICLE)
    expect(p.ascentM).toBeGreaterThan(2500)
    const climbKwh = p.ascentM * p.climbKwhPerM
    // Worth more than a fifth of the usable pack. This is why elevation is in
    // phase 3 and not the icebox.
    expect(climbKwh / VEHICLE.usableKwh).toBeGreaterThan(0.2)
  })
})

// -------------------------------------------------------------- planner ----
describe('planner: phase 3 gate', () => {
  const cases = []
  for (const [key, fx] of Object.entries(ROUTES)) {
    for (const strategy of STRATEGIES) {
      cases.push({ key, name: fx.name, route: fx.route, strategy })
    }
  }

  it.each(cases)('$name / $strategy.name produces a feasible plan', ({ route, strategy }) => {
    const plan = planTrip({
      route,
      stations: corridor(route),
      vehicle: VEHICLE,
      strategy,
      startSoc: strategiesFile.defaultStartSoc,
    })
    expect(plan.feasible).toBe(true)
    expect(plan.stops.length).toBeGreaterThan(0)
  })

  it.each(cases)(
    '$name / $strategy.name never dips below the reserve floor',
    ({ route, strategy }) => {
      const plan = planTrip({
        route,
        stations: corridor(route),
        vehicle: VEHICLE,
        strategy,
        startSoc: strategiesFile.defaultStartSoc,
      })
      // The invariant. A plan that violates the floor is a bug, not a warning.
      expect(plan.summary.minSocReached).toBeGreaterThanOrEqual(strategy.reserveFloor - 1e-6)
      for (const stop of plan.stops) {
        expect(stop.arriveSoc).toBeGreaterThanOrEqual(strategy.reserveFloor - 1e-6)
        expect(stop.departSoc).toBeLessThanOrEqual(100)
        expect(stop.departSoc).toBeGreaterThanOrEqual(stop.arriveSoc)
      }
      expect(plan.summary.arriveSocAtDestination).toBeGreaterThanOrEqual(
        strategy.reserveFloor - 1e-6
      )
    }
  )

  it('the corridor override fires on the sparse Bishop to Carson City leg', () => {
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: corridor(ROUTES.tahoe.route),
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    const overridden = plan.stops.filter((s) => s.overrideReason)
    expect(overridden.length).toBeGreaterThan(0)
    const o = overridden[0]
    expect(['sparse-corridor', 'elevation']).toContain(o.overrideReason)
    // It must raise the departure above the window, and explain itself.
    expect(o.departSoc).toBeGreaterThan(STRATEGIES[0].departSocTarget)
    expect(o.overrideDetail.nextGapMiles).toBeGreaterThan(60)
    expect(o.overrideDetail.nextStopName).toBeTruthy()
  })

  it('no override fires when the corridor is dense', () => {
    const dense = corridor(ROUTES.tahoe.route, { minKw: 50, maxDetourMi: 10 })
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: dense,
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    expect(plan.stops.some((s) => s.overrideReason)).toBe(false)
  })

  it('the shallow window trades charge time for more stops and more overhead', () => {
    const stations = corridor(ROUTES.tahoe.route)
    const hop = planTrip({ route: ROUTES.tahoe.route, stations, vehicle: VEHICLE, strategy: STRATEGIES[0], startSoc: 50 })
    const classic = planTrip({ route: ROUTES.tahoe.route, stations, vehicle: VEHICLE, strategy: STRATEGIES[1], startSoc: 50 })
    expect(hop.summary.stopCount).toBeGreaterThan(classic.summary.stopCount)
    expect(hop.summary.chargeMinutes).toBeLessThan(classic.summary.chargeMinutes)
    expect(hop.summary.overheadMinutes).toBeGreaterThan(classic.summary.overheadMinutes)
  })

  it('total time accounts for drive, charge, overhead and detour with nothing hidden', () => {
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: corridor(ROUTES.tahoe.route),
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    const s = plan.summary
    expect(s.totalMinutes).toBeGreaterThan(s.driveMinutes)
    expect(
      Math.abs(
        s.totalMinutes - (s.driveMinutes + s.chargeMinutes + s.overheadMinutes + s.detourMinutes)
      )
    ).toBeLessThanOrEqual(2)
    expect(s.overheadMinutes).toBe(s.stopCount * STRATEGIES[0].overheadMinPerStop)
  })

  it('stations with unknown power are excluded and the exclusion is stated', () => {
    const withUnknown = annotateStations(STATIONS, ROUTES.tahoe.route.geometry).filter(
      (s) => s.detour_m / MILES <= 5
    )
    expect(withUnknown.some((s) => s.kwSource === 'unknown')).toBe(true)
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: withUnknown,
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    expect(plan.stops.every((s) => s.kwSource !== 'unknown')).toBe(true)
    expect(plan.warnings.join(' ')).toMatch(/no reported power/i)
  })

  it('reports infeasible rather than inventing a plan when there is nowhere to charge', () => {
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: [],
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    expect(plan.feasible).toBe(false)
    expect(plan.warnings.join(' ')).toMatch(/reachable|reserve/i)
  })

  it('a short trip inside the starting range needs no stops at all', () => {
    const short = {
      ...ROUTES.tahoe.route,
      geometry: ROUTES.tahoe.route.geometry.slice(0, 20),
      duration_s: 2400,
    }
    const plan = planTrip({
      route: short,
      stations: corridor(short),
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    expect(plan.feasible).toBe(true)
    expect(plan.stops.length).toBe(0)
    expect(plan.summary.totalMinutes).toBe(plan.summary.driveMinutes)
  })
})

// ------------------------------------------------------------ invariants ----
describe('planner: the reserve floor holds under fuzzing', () => {
  it('never violates the floor across many strategies and start SOCs', () => {
    // Deterministic pseudo-random sweep: no Math.random, so a failure is
    // always reproducible.
    let seed = 12345
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    let checked = 0
    for (const fx of Object.values(ROUTES)) {
      for (let i = 0; i < 60; i++) {
        const reserveFloor = 5 + Math.floor(rand() * 12)
        const arriveSocTarget = reserveFloor + 1 + Math.floor(rand() * 15)
        const departSocTarget = arriveSocTarget + 5 + Math.floor(rand() * 45)
        const strategy = {
          arriveSocTarget,
          departSocTarget: Math.min(100, departSocTarget),
          taperCutoffKw: [0, 50, 100, 150][Math.floor(rand() * 4)],
          reserveFloor,
          overheadMinPerStop: Math.floor(rand() * 12),
        }
        const startSoc = 30 + Math.floor(rand() * 70)
        const minKw = [50, 150, 250][Math.floor(rand() * 3)]
        const plan = planTrip({
          route: fx.route,
          stations: corridor(fx.route, { minKw, maxDetourMi: 5 + rand() * 10 }),
          vehicle: VEHICLE,
          strategy,
          startSoc,
        })
        if (!plan.feasible) continue
        checked++
        expect(plan.summary.minSocReached).toBeGreaterThanOrEqual(reserveFloor - 1e-6)
        for (const stop of plan.stops) {
          expect(stop.arriveSoc).toBeGreaterThanOrEqual(reserveFloor - 1e-6)
          expect(stop.departSoc).toBeLessThanOrEqual(100.0001)
        }
      }
    }
    expect(checked).toBeGreaterThan(40)
  })
})

// ------------------------------------------------------- live AFDC data ----
/**
 * These run against REAL station data captured from developer.nlr.gov on
 * 2026-08-12 for the Ventura -> South Lake Tahoe corridor. The route geometry
 * is still synthetic, but the stations, their networks and their power ratings
 * are the genuine article -- which is what the phase 3 gate actually needs to
 * be worth anything.
 */
describe('planner against real AFDC station data', () => {
  const live = read('./fixtures/stations-us395-live.json')
  const annotated = (route) => annotateStations(live.stations, route.geometry)
  const corridorLive = (route, { minKw = 250, maxDetourMi = 5 } = {}) =>
    annotated(route).filter((s) => s.detour_m / MILES <= maxDetourMi && (s.maxKw ?? 0) >= minKw)

  it('the real corridor has meaningful 250 kW+ coverage', () => {
    const fast = corridorLive(ROUTES.tahoe.route)
    expect(fast.length).toBeGreaterThan(20)
    expect(new Set(live.stations.map((s) => s.network)).size).toBeGreaterThan(5)
  })

  it('AFDC reported power for every station on this corridor (answers Q2)', () => {
    // Measured, not assumed: 90/90 stations carried a real power_kw figure.
    // If a future capture regresses, this test is where we find out.
    const unknown = live.stations.filter((s) => s.kwSource === 'unknown')
    expect(unknown.length).toBe(0)
    expect(live.stations.every((s) => s.kwSource === 'reported')).toBe(true)
  })

  it.each(STRATEGIES)('$name produces a feasible plan that respects the reserve floor', (strategy) => {
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: corridorLive(ROUTES.tahoe.route),
      vehicle: VEHICLE,
      strategy,
      startSoc: strategiesFile.defaultStartSoc,
    })
    expect(plan.feasible).toBe(true)
    expect(plan.summary.minSocReached).toBeGreaterThanOrEqual(strategy.reserveFloor - 1e-6)
    for (const stop of plan.stops) {
      expect(stop.arriveSoc).toBeGreaterThanOrEqual(strategy.reserveFloor - 1e-6)
      expect(stop.chargeMinutes).toBeGreaterThan(0)
    }
  })

  it('charge minutes stay in a physically credible range on real hardware', () => {
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: corridorLive(ROUTES.tahoe.route),
      vehicle: VEHICLE,
      strategy: STRATEGIES[0],
      startSoc: 50,
    })
    for (const stop of plan.stops) {
      // A 78 kWh pack on a 250 kW+ post cannot take an hour for a 38-point
      // window, and cannot do it in under two minutes either.
      expect(stop.chargeMinutes).toBeGreaterThan(1)
      expect(stop.chargeMinutes).toBeLessThan(45)
      expect(stop.avgKw).toBeGreaterThan(40)
      expect(stop.avgKw).toBeLessThanOrEqual(stop.station.maxKw)
    }
  })

  it('the shallow window is competitive with the classic one on the real corridor', () => {
    const stations = corridorLive(ROUTES.tahoe.route)
    const hop = planTrip({ route: ROUTES.tahoe.route, stations, vehicle: VEHICLE, strategy: STRATEGIES[0], startSoc: 50 })
    const classic = planTrip({ route: ROUTES.tahoe.route, stations, vehicle: VEHICLE, strategy: STRATEGIES[1], startSoc: 50 })
    // Neither should be absurdly better; the whole point of strategy compare is
    // that the answer is close and worth actually looking at.
    const deltaMin = Math.abs(hop.summary.totalMinutes - classic.summary.totalMinutes)
    expect(deltaMin).toBeLessThan(60)
    expect(hop.summary.totalMinutes).toBeGreaterThan(hop.summary.driveMinutes)
  })
})

// ------------------------------------------------- regressions (reviewer) ---
describe('regressions found by the gate review', () => {
  it('one malformed station coordinate does not take the whole corridor down', () => {
    // The Worker's normalizer legitimately emits null coordinates when
    // upstream data is malformed. Previously this threw out of turf and the
    // trip lost every station.
    const good = read('./fixtures/stations-us395-live.json').stations
    const poisoned = [
      { ...good[0], id: 'bad:null', lat: null, lon: null },
      { ...good[1], id: 'bad:nan', lat: NaN, lon: NaN },
      { ...good[2], id: 'bad:range', lat: 999, lon: -999 },
      ...good,
    ]
    const annotated = annotateStations(poisoned, ROUTES.tahoe.route.geometry)
    expect(annotated.length).toBe(good.length)
    expect(annotated.some((s) => String(s.id).startsWith('bad:'))).toBe(false)
    expect(annotated.every((s) => Number.isFinite(s.distanceAlongRoute_m))).toBe(true)
  })

  it('a corrupted strategy cannot make stopping faster than not stopping', () => {
    // Reachable via a hand-edited localStorage strategy, which nothing revalidates.
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: corridor(ROUTES.tahoe.route),
      vehicle: VEHICLE,
      strategy: { ...STRATEGIES[0], overheadMinPerStop: -50 },
      startSoc: 50,
    })
    expect(plan.summary.overheadMinutes).toBeGreaterThanOrEqual(0)
    expect(plan.summary.totalMinutes).toBeGreaterThanOrEqual(plan.summary.driveMinutes)
  })

  it('a non-numeric overhead degrades to zero rather than to NaN', () => {
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations: corridor(ROUTES.tahoe.route),
      vehicle: VEHICLE,
      strategy: { ...STRATEGIES[0], overheadMinPerStop: 'oops' },
      startSoc: 50,
    })
    expect(Number.isFinite(plan.summary.totalMinutes)).toBe(true)
    expect(plan.summary.overheadMinutes).toBe(0)
  })
})

// ---------------------------------------------------------- distance smoothing --
describe('distance-based elevation smoothing (D-023)', () => {
  it('gives the same result regardless of how densely the route is sampled', () => {
    // The bug this replaced: a POINT-COUNT window is a different filter at
    // every point when vertex spacing varies -- and real ORS routes vary from
    // under 2m to nearly 7km between vertices on this project's own corridor.
    // A real-distance window must not care how many vertices represent a
    // given stretch of road.
    const dense = []
    const sparse = []
    // Same 5km climb (500m over 5km, a 10% average grade), sampled every 10m
    // vs every 200m.
    for (let i = 0; i <= 500; i++) dense.push([-119 + i * 0.0001, 38, i * 1])
    for (let i = 0; i <= 25; i++) sparse.push([-119 + i * 0.002, 38, i * 20])
    const vehicle = { consumptionWhPerMile: 235, massKg: 2050, drivetrainEfficiency: 0.85, regenEfficiency: 0.7 }
    const denseP = buildEnergyProfile(dense, vehicle)
    const sparseP = buildEnergyProfile(sparse, vehicle)
    // Within 5% of each other despite a 20x difference in point density.
    expect(Math.abs(denseP.ascentM - sparseP.ascentM) / sparseP.ascentM).toBeLessThan(0.05)
  })

  it('a window far smaller than the point spacing degrades to no smoothing, not a crash', () => {
    const sparse = []
    for (let i = 0; i <= 20; i++) sparse.push([-119 + i * 0.01, 38, i % 2 === 0 ? 500 : 520])
    const vehicle = { consumptionWhPerMile: 235, massKg: 2050, drivetrainEfficiency: 0.85, regenEfficiency: 0.7 }
    const p = buildEnergyProfile(sparse, vehicle, { smoothWindowM: 1 })
    expect(Number.isFinite(p.ascentM)).toBe(true)
    expect(p.ascentM).toBeGreaterThan(0)
  })
})

// ------------------------------------------------- real default-route data --
/**
 * These use REAL routes captured from the deployed Worker on 2026-08-12 --
 * genuine ORS output, genuine elevation. Not the corridor DESIGN.md's gate
 * text names ("via US-395"): ORS's default routing does not take US-395 for
 * either trip. Ventura->South Lake Tahoe goes via I-5 + US-50 (Echo Summit);
 * Ventura->Reno goes via I-5 + I-80 (Donner Pass). Both are real mountain
 * crossings DESIGN.md's own §5.1 names as the reason elevation is modelled at
 * all, so this is arguably a better real-world validation than a hand-built
 * 395 fixture would have been. See D-022.
 */
describe('planner against real default-route data (not the US-395 corridor)', () => {
  const fixtures = {
    slt: {
      route: read('./fixtures/route-slt-default-live.json'),
      stations: read('./fixtures/stations-slt-default-route-live.json'),
    },
    reno: {
      route: read('./fixtures/route-reno-default-live.json'),
      stations: read('./fixtures/stations-reno-default-route-live.json'),
    },
  }

  function realCorridor(key, { minKw = 250, maxDetourMi = 5 } = {}) {
    const { route, stations } = fixtures[key]
    return annotateStations(stations.stations, route.route.geometry).filter(
      (s) => s.detour_m / MILES <= maxDetourMi && (s.maxKw ?? 0) >= minKw
    )
  }

  it('both real corridors have dense 250kW+ coverage -- more than the 395 corridor', () => {
    // I-5 and I-80 are major interstates; expect denser coverage than the
    // US-395 mountain corridor's 46 stations.
    expect(realCorridor('slt').length).toBeGreaterThan(60)
    expect(realCorridor('reno').length).toBeGreaterThan(60)
  })

  it('every station on both real corridors reports power (further confirms Q2)', () => {
    for (const key of ['slt', 'reno']) {
      const all = fixtures[key].stations.stations
      expect(all.every((s) => s.kwSource === 'reported')).toBe(true)
    }
  })

  it.each(['slt', 'reno'])('%s: the real climb is substantial enough to matter', (key) => {
    const { route } = fixtures[key]
    const vehicle = VEHICLE
    const profile = buildEnergyProfile(route.route.geometry, vehicle)
    expect(profile.elevationAvailable).toBe(true)
    expect(profile.ascentM).toBeGreaterThan(4000)
    const climbKwh = profile.ascentM * profile.climbKwhPerM
    expect(climbKwh / vehicle.usableKwh).toBeGreaterThan(0.3)
  })

  it.each(['slt', 'reno'])('%s: every strategy stays feasible and above the reserve floor', (key) => {
    const { route } = fixtures[key]
    for (const strategy of STRATEGIES) {
      const plan = planTrip({
        route: route.route,
        stations: realCorridor(key),
        vehicle: VEHICLE,
        strategy,
        startSoc: strategiesFile.defaultStartSoc,
      })
      expect(plan.feasible).toBe(true)
      expect(plan.summary.minSocReached).toBeGreaterThanOrEqual(strategy.reserveFloor - 1e-6)
      for (const stop of plan.stops) {
        expect(stop.arriveSoc).toBeGreaterThanOrEqual(strategy.reserveFloor - 1e-6)
      }
    }
  })
})

// ------------------------------------------------- gate re-cert regressions --
describe('regressions found by the gate 1-3 re-certification', () => {
  it('a negative reserveFloor in a corrupted strategy cannot produce a negative destination SOC', () => {
    // The exact repro from the reviewer: a hand-edited/corrupted saved
    // strategy with reserveFloor: -20 previously let the loop exit at
    // summary.arriveSocAtDestination = -19 -- the literal invariant held
    // against itself (-19 >= -20) but the safety intent (never dip below a
    // real floor) was defeated. reserveFloor must clamp into [0, 100].
    const stations = corridor(ROUTES.tahoe.route)
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations,
      vehicle: VEHICLE,
      strategy: { arriveSocTarget: 12, departSocTarget: 50, taperCutoffKw: 100, reserveFloor: -20, overheadMinPerStop: 5 },
      startSoc: 50,
    })
    if (plan.feasible) {
      expect(plan.summary.minSocReached).toBeGreaterThanOrEqual(0)
      expect(plan.summary.arriveSocAtDestination).toBeGreaterThanOrEqual(0)
    }
  })

  it('a null reserveFloor falls back to the documented default, not to an effective 0', () => {
    // Destructuring defaults only trigger on `undefined`. `x >= null` numeric-
    // coerces null to 0, so a genuinely-null value previously produced an
    // effective 0% floor instead of the intended default of 8.
    const stations = corridor(ROUTES.tahoe.route)
    const plan = planTrip({
      route: ROUTES.tahoe.route,
      stations,
      vehicle: VEHICLE,
      strategy: { arriveSocTarget: 12, departSocTarget: 50, taperCutoffKw: 100, reserveFloor: null, overheadMinPerStop: 5 },
      startSoc: 50,
    })
    expect(plan.summary.minSocReached).toBeGreaterThanOrEqual(8 - 1e-6)
  })

  it('smoothElevationsByDistance does not misbehave on a negative window', () => {
    const geom = ROUTES.tahoe.route.geometry.slice(0, 50)
    const vehicle = VEHICLE
    const p = buildEnergyProfile(geom, vehicle, { smoothWindowM: -500 })
    expect(Number.isFinite(p.ascentM)).toBe(true)
    expect(p.ascentM).toBeGreaterThanOrEqual(0)
  })
})
