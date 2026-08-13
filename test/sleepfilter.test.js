import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { visibleSleepFeatures, activeJurisdictionWarnings } from '../src/state.js'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)))
const geometry = read('./fixtures/route-slt-default-live.json').route.geometry

function feature(id, category, lon, lat, extra = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { id, category, name: id, verified: true, ...extra },
  }
}

// A point directly on the route near its start (Ventura), and one ~30 real
// miles off to the west -- both used to exercise the detour-distance filter.
const ON_ROUTE = geometry[50] // [lon, lat, ele]
const FAR_OFF_ROUTE = [-121.5, 39.5] // nowhere near the SLT route

describe('visibleSleepFeatures', () => {
  const baseState = () => ({
    sleepCategoryEnabled: { 'rest-area': true, casino: true },
    sleepFeatures: [
      feature('near', 'rest-area', ON_ROUTE[0], ON_ROUTE[1]),
      feature('far', 'casino', FAR_OFF_ROUTE[0], FAR_OFF_ROUTE[1]),
      feature('near-disabled-cat', 'casino', ON_ROUTE[0] + 0.001, ON_ROUTE[1] + 0.001),
    ],
    sleepDetourMi: 20,
    route: null,
  })

  it('with no route, shows everything in an enabled category regardless of distance', () => {
    const s = baseState()
    const ids = visibleSleepFeatures(s).map((f) => f.properties.id)
    expect(ids).toContain('near')
    expect(ids).toContain('far')
  })

  it('with a route, excludes features farther than sleepDetourMi', () => {
    const s = { ...baseState(), route: { geometry } }
    const ids = visibleSleepFeatures(s).map((f) => f.properties.id)
    expect(ids).toContain('near')
    expect(ids).not.toContain('far')
  })

  it('widening sleepDetourMi brings a farther feature back in range', () => {
    const s = { ...baseState(), route: { geometry }, sleepDetourMi: 5 }
    expect(visibleSleepFeatures(s).map((f) => f.properties.id)).not.toContain('far')

    // FAR_OFF_ROUTE is roughly 150-200mi from this route -- a huge detour
    // tolerance is the honest way to prove the filter is distance-driven,
    // not a coincidence of the specific default.
    const wide = { ...s, sleepDetourMi: 400 }
    expect(visibleSleepFeatures(wide).map((f) => f.properties.id)).toContain('far')
  })

  it('category toggle still applies independent of distance', () => {
    const s = {
      ...baseState(),
      route: { geometry },
      sleepCategoryEnabled: { 'rest-area': true, casino: false },
    }
    const ids = visibleSleepFeatures(s).map((f) => f.properties.id)
    expect(ids).not.toContain('near-disabled-cat')
  })
})

describe('activeJurisdictionWarnings', () => {
  it('returns nothing when no trip endpoints are set', () => {
    expect(activeJurisdictionWarnings({ from: null, to: null, sleepFeatures: [] })).toEqual([])
  })

  it('warns when the destination is South Lake Tahoe, and finds the nearest legal pin', () => {
    const s = {
      from: { label: 'Ventura, CA', lat: 34.2746, lon: -119.229 },
      to: { label: 'South Lake Tahoe, CA', lat: 38.9399, lon: -119.9772 },
      sleepFeatures: [
        // Inside the SLT radius -- must NOT be offered as the "nearest option"
        // (matches the real dataset: no pins exist inside the restricted zone).
        feature('too-close', 'casino', -119.98, 38.94),
        // Minden, NV -- the real nearest legal option in the shipped dataset.
        feature('minden', 'casino', -119.7649, 38.9538, {
          name: 'Carson Valley Inn Casino -- Minden',
        }),
      ],
    }
    const warnings = activeJurisdictionWarnings(s)
    const tahoe = warnings.find((w) => w.id === 'jx-south-lake-tahoe')
    expect(tahoe).toBeTruthy()
    expect(tahoe.role).toBe('to')
    expect(tahoe.nearestOption.name).toBe('Carson Valley Inn Casino -- Minden')
    expect(tahoe.nearestOption).not.toBeNull()
  })

  it('does not warn for an unrestricted destination', () => {
    const s = {
      from: { label: 'Ventura, CA', lat: 34.2746, lon: -119.229 },
      to: { label: 'Bakersfield, CA', lat: 35.3733, lon: -119.0187 },
      sleepFeatures: [],
    }
    expect(activeJurisdictionWarnings(s)).toEqual([])
  })

  it('warns on the origin too, not just the destination', () => {
    const s = {
      from: { label: 'Reno, NV', lat: 39.5296, lon: -119.8138 },
      to: { label: 'Bakersfield, CA', lat: 35.3733, lon: -119.0187 },
      sleepFeatures: [],
    }
    const warnings = activeJurisdictionWarnings(s)
    expect(warnings.some((w) => w.id === 'jx-reno' && w.role === 'from')).toBe(true)
  })

  it('prefers a verified option over a closer unverified one', () => {
    // Live repro: Ventura->Reno recommended "Boomtown Casino Hotel -- Verdi"
    // (verified:false, its own notes say sources conflict on whether
    // overnight parking is even allowed) over "Gold Ranch" (verified:true),
    // which was only ~2mi farther. A "legal alternative" must not be a
    // coin flip.
    const s = {
      from: null,
      to: { label: 'Reno, NV', lat: 39.5296, lon: -119.8138 },
      sleepFeatures: [
        feature('boomtown', 'casino', -119.99, 39.52, {
          name: 'Boomtown Casino Hotel -- Verdi',
          verified: false,
        }),
        feature('gold-ranch', 'casino', -120.0, 39.53, {
          name: 'Gold Ranch Casino & RV Resort -- Verdi',
          verified: true,
        }),
      ],
    }
    const reno = activeJurisdictionWarnings(s).find((w) => w.id === 'jx-reno')
    expect(reno.nearestOption.name).toBe('Gold Ranch Casino & RV Resort -- Verdi')
    expect(reno.nearestOption.unverified).toBe(false)
  })

  it('falls back to an unverified option when no verified one exists, and says so', () => {
    const s = {
      from: null,
      to: { label: 'Reno, NV', lat: 39.5296, lon: -119.8138 },
      sleepFeatures: [
        feature('only-option', 'casino', -119.99, 39.52, {
          name: 'Only Unverified Option',
          verified: false,
        }),
      ],
    }
    const reno = activeJurisdictionWarnings(s).find((w) => w.id === 'jx-reno')
    expect(reno.nearestOption.name).toBe('Only Unverified Option')
    expect(reno.nearestOption.unverified).toBe(true)
  })
})
