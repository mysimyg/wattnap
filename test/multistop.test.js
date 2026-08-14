import { describe, it, expect } from 'vitest'
import { computeWaypoints, combineLegPlans } from '../src/state.js'

// The live worker deploy needed to exercise phase 6 end-to-end was blocked
// (production deploy denied pending explicit user sign-off -- see STATE.md).
// This is the client-side half of that verification: the pure orchestration
// logic (computeWaypoints, combineLegPlans) doesn't need a live route
// response at all, so it's fully checkable without the deploy.

describe('computeWaypoints', () => {
  const from = { label: 'Ventura, CA', lat: 34.27, lon: -119.29 }
  const to = { label: 'South Lake Tahoe, CA', lat: 38.93, lon: -119.98 }
  const via = { label: 'Bakersfield, CA', lat: 35.37, lon: -119.02 }

  it('is just [from, to] with no vias and no round trip -- the plain A-to-B case', () => {
    expect(computeWaypoints({ from, to, vias: [], roundTrip: false })).toEqual([from, to])
  })

  it('inserts vias in order between from and to', () => {
    const via2 = { label: 'Reno, NV', lat: 39.53, lon: -119.81 }
    expect(computeWaypoints({ from, to, vias: [via, via2], roundTrip: false })).toEqual([from, via, via2, to])
  })

  it('round trip appends `from` as a final leg (Ventura -> Vegas -> Dallas -> Ventura is 4 legs, one toggle)', () => {
    const vegas = { label: 'Las Vegas, NV', lat: 36.17, lon: -115.14 }
    const dallas = { label: 'Dallas, TX', lat: 32.78, lon: -96.8 }
    const waypoints = computeWaypoints({ from, to: dallas, vias: [vegas], roundTrip: true })
    expect(waypoints).toEqual([from, vegas, dallas, from])
    expect(waypoints.length - 1).toBe(3) // 3 legs
  })

  it('drops a null from/to rather than crashing (defensive -- canPlan already gates the UI on both being set)', () => {
    expect(computeWaypoints({ from: null, to, vias: [], roundTrip: false })).toEqual([to])
    expect(computeWaypoints({ from, to: null, vias: [], roundTrip: false })).toEqual([from])
  })
})

// Minimal fixture matching planner.js's real buildPlan()/infeasible() shape.
function fakeLegPlan(overrides = {}) {
  return {
    feasible: true,
    stops: [],
    warnings: [],
    summary: {
      driveMinutes: 60,
      chargeMinutes: 20,
      overheadMinutes: 5,
      detourMinutes: 2,
      totalMinutes: 87,
      stopCount: 1,
      minSocReached: 15,
      arriveSocAtDestination: 40,
      startSoc: 50,
      distanceMiles: 50,
      ascentM: 100,
      descentM: 80,
      elevationAvailable: true,
    },
    ...overrides,
  }
}

describe('combineLegPlans', () => {
  const waypoints = [
    { label: 'Ventura, CA' },
    { label: 'Bakersfield, CA' },
    { label: 'South Lake Tahoe, CA' },
  ]

  it('passes a single leg through unchanged in shape (the plain A-to-B case reduces to N=1)', () => {
    const leg = fakeLegPlan()
    const plan = combineLegPlans([leg], 1, [waypoints[0], waypoints[2]])
    expect(plan.feasible).toBe(true)
    expect(plan.summary).toEqual(leg.summary)
    expect(plan.stops).toEqual([])
    // No via milestone for a single leg -- there is no via to mark arrival at.
    expect(plan.stops.some((s) => s.isViaMilestone)).toBe(false)
  })

  it('sums additive summary fields and carries the LAST leg arrival SOC / FIRST leg start SOC across legs', () => {
    const leg1 = fakeLegPlan({ summary: { ...fakeLegPlan().summary, driveMinutes: 60, totalMinutes: 87, startSoc: 50, arriveSocAtDestination: 40, minSocReached: 12 } })
    const leg2 = fakeLegPlan({ summary: { ...fakeLegPlan().summary, driveMinutes: 90, totalMinutes: 130, startSoc: 40, arriveSocAtDestination: 22, minSocReached: 9 } })
    const plan = combineLegPlans([leg1, leg2], 2, waypoints)
    expect(plan.summary.driveMinutes).toBe(150) // 60 + 90
    expect(plan.summary.totalMinutes).toBe(217) // 87 + 130
    expect(plan.summary.startSoc).toBe(50) // leg1's startSoc, not leg2's
    expect(plan.summary.arriveSocAtDestination).toBe(22) // leg2's, the trip's real final SOC
    expect(plan.summary.minSocReached).toBe(9) // the lower of the two legs' minima, not leg2's alone
  })

  it('inserts a via milestone between legs, naming the via and the SOC the vehicle actually arrives with', () => {
    const leg1 = fakeLegPlan({ summary: { ...fakeLegPlan().summary, arriveSocAtDestination: 33 } })
    const leg2 = fakeLegPlan()
    const plan = combineLegPlans([leg1, leg2], 2, waypoints)
    const milestone = plan.stops.find((s) => s.isViaMilestone)
    expect(milestone).toBeTruthy()
    expect(milestone.viaLabel).toBe('Bakersfield, CA')
    expect(milestone.arriveSoc).toBe(33)
  })

  it('never inserts a milestone after the LAST leg -- that arrival is the real destination, not a via', () => {
    const plan = combineLegPlans([fakeLegPlan(), fakeLegPlan()], 2, waypoints)
    expect(plan.stops.filter((s) => s.isViaMilestone)).toHaveLength(1) // 2 legs -> 1 boundary, not 2
  })

  it('marks the whole trip infeasible if any leg is infeasible, but still credits real progress on the legs that succeeded', () => {
    const leg1 = fakeLegPlan({ feasible: true })
    const leg2 = fakeLegPlan({ feasible: false, warnings: ['No charger reachable before the reserve floor.'] })
    // recomputePlan breaks the loop on the first infeasible leg, so leg 3
    // never gets attempted -- legPlans.length (2) < totalLegs (3) here.
    const plan = combineLegPlans([leg1, leg2], 3, [...waypoints, { label: 'Reno, NV' }])
    expect(plan.feasible).toBe(false)
    // leg1 genuinely succeeded -- the vehicle really did arrive at the via
    // -- so its milestone still shows even though leg2 then failed.
    expect(plan.stops.filter((s) => s.isViaMilestone)).toHaveLength(1)
    expect(plan.warnings.join(' ')).toMatch(/Leg 2 of 3/)
  })

  it('prefixes warnings with their leg number only for a real multi-leg trip, not a plain A-to-B one', () => {
    const single = combineLegPlans([fakeLegPlan({ warnings: ['heads up'] })], 1, [waypoints[0], waypoints[2]])
    expect(single.warnings).toEqual(['heads up'])
    const multi = combineLegPlans([fakeLegPlan({ warnings: ['heads up'] }), fakeLegPlan()], 2, waypoints)
    expect(multi.warnings[0]).toBe('Leg 1 of 2: heads up')
  })
})
