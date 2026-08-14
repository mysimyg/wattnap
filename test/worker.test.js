// test/worker.test.js
//
// Pure-function unit tests for the Worker (no network, no live KV/Cloudflare
// runtime). Run with `npx vitest run test/worker.test.js`.

import { describe, it, expect } from 'vitest';
import {
  normalizeAfdcStation,
  normalizeOcmStation,
  filterStationsByKw,
  inferMaxKw,
} from '../worker/src/normalize.js';
import { buildWkt, buildOrsDirectionsBody, splitIntoLegs, UpstreamError } from '../worker/src/upstream.js';
import {
  isOriginAllowed,
  parseAllowedOrigins,
  DEFAULT_ALLOWED_ORIGINS,
} from '../worker/src/index.js';
import { canonicalizeJson, computeCacheKey, sortKeysDeep } from '../worker/src/cache.js';

// ---------------------------------------------------------------------------
// Station normalization — AFDC
// ---------------------------------------------------------------------------

describe('normalizeAfdcStation', () => {
  // Shape verified against live developer.nlr.gov traffic 2026-08-12:
  // ev_charging_units[] nests power by connector type
  // (unit.connectors.<TYPE>.power_kw), not a flat unit.power_kw — DESIGN.md
  // §2.1's flatter description does not match the real API.
  it('reports maxKw from the real nested ev_charging_units[].connectors[type].power_kw shape', () => {
    const raw = {
      id: 12345,
      station_name: 'Tesla Supercharger - Mojave, CA',
      ev_network: 'Tesla',
      latitude: 35.0525,
      longitude: -118.1745,
      street_address: '1 Main St',
      city: 'Mojave',
      state: 'CA',
      zip: '93501',
      access_code: 'public',
      status_code: 'E',
      ev_connector_types: ['TESLA'],
      ev_dc_fast_num: 12,
      ev_level2_evse_num: 0,
      ev_charging_units: [
        {
          network: 'Tesla',
          connectors: {
            J1772: { power_kw: null, port_count: 0 },
            TESLA: { power_kw: 250, port_count: 1 },
            CHADEMO: { power_kw: null, port_count: 0 },
            J1772COMBO: { power_kw: null, port_count: 0 },
          },
          port_count: 1,
          charging_level: 'dc_fast',
        },
        {
          network: 'Tesla',
          connectors: { TESLA: { power_kw: 150, port_count: 1 } },
          port_count: 1,
          charging_level: 'dc_fast',
        },
      ],
    };
    const station = normalizeAfdcStation(raw);
    expect(station.id).toBe('afdc:12345');
    expect(station.source).toBe('afdc');
    expect(station.maxKw).toBe(250);
    expect(station.kwSource).toBe('reported');
    expect(station.connectors).toEqual(['TESLA']);
    expect(station.portCount).toBe(12);
    expect(station.address).toBe('1 Main St, Mojave, CA, 93501');
  });

  it('also accepts the flatter unit.power_kw shape defensively (belt and suspenders)', () => {
    const raw = {
      id: 777,
      station_name: 'Flat Shape Site',
      ev_connector_types: ['TESLA'],
      ev_dc_fast_num: 1,
      ev_charging_units: [{ power_kw: 120 }],
    };
    const station = normalizeAfdcStation(raw);
    expect(station.maxKw).toBe(120);
    expect(station.kwSource).toBe('reported');
  });

  it('infers a conservative maxKw for a DC fast connector with no power data (kwSource: inferred)', () => {
    const raw = {
      id: 999,
      station_name: 'Some CCS Site',
      ev_connector_types: ['J1772COMBO'],
      ev_dc_fast_num: 2,
      ev_level2_evse_num: 0,
      // no ev_charging_units at all
    };
    const station = normalizeAfdcStation(raw);
    expect(station.kwSource).toBe('inferred');
    expect(station.maxKw).toBe(50);
  });

  it('reports unknown when nothing is derivable (no power, no DC fast connector/level signal)', () => {
    const raw = {
      id: 1,
      station_name: 'Mystery L2 Site',
      ev_connector_types: [],
      ev_dc_fast_num: 0,
      ev_level2_evse_num: 4,
    };
    const station = normalizeAfdcStation(raw);
    expect(station.kwSource).toBe('unknown');
    expect(station.maxKw).toBeNull();
  });

  it('never lets an inferred value masquerade as reported', () => {
    const raw = {
      id: 2,
      ev_connector_types: ['TESLA'],
      ev_dc_fast_num: 1,
      ev_charging_units: [{ power_kw: null }, {}], // present but not usable numbers
    };
    const station = normalizeAfdcStation(raw);
    expect(station.kwSource).not.toBe('reported');
    expect(station.kwSource).toBe('inferred');
  });
});

// ---------------------------------------------------------------------------
// Station normalization — OpenChargeMap
// ---------------------------------------------------------------------------

describe('normalizeOcmStation', () => {
  it('reports maxKw from Connections[].PowerKW when present (kwSource: reported)', () => {
    const raw = {
      ID: 555,
      AddressInfo: {
        Title: 'EVgo - Bishop',
        AddressLine1: '100 Main St',
        Town: 'Bishop',
        StateOrProvince: 'CA',
        Postcode: '93514',
        Latitude: 37.3614,
        Longitude: -118.3948,
      },
      OperatorInfo: { Title: 'EVgo' },
      UsageType: { IsMembershipRequired: false },
      StatusType: { IsOperational: true },
      NumberOfPoints: 4,
      Connections: [
        { ConnectionType: { Title: 'CCS (Type 1)' }, PowerKW: 150 },
        { ConnectionType: { Title: 'CHAdeMO' }, PowerKW: 50 },
      ],
    };
    const station = normalizeOcmStation(raw);
    expect(station.id).toBe('ocm:555');
    expect(station.source).toBe('ocm');
    expect(station.maxKw).toBe(150);
    expect(station.kwSource).toBe('reported');
    expect(station.connectors).toEqual(['J1772COMBO', 'CHADEMO']);
    expect(station.status).toBe('E');
  });

  it('infers a conservative maxKw for a fast-charge-capable connection with no PowerKW', () => {
    const raw = {
      ID: 556,
      AddressInfo: { Title: 'Unknown DC Site', Latitude: 1, Longitude: 2 },
      Connections: [{ ConnectionType: { Title: 'Tesla' }, Level: { IsFastChargeCapable: true } }],
    };
    const station = normalizeOcmStation(raw);
    expect(station.kwSource).toBe('inferred');
    expect(station.maxKw).toBe(50);
  });

  it('reports unknown when there is no power figure and no fast-charge signal', () => {
    const raw = {
      ID: 557,
      AddressInfo: { Title: 'Level 2 Only', Latitude: 1, Longitude: 2 },
      Connections: [{ ConnectionType: { Title: 'J1772' }, Level: { Title: 'Level 2' } }],
    };
    const station = normalizeOcmStation(raw);
    expect(station.kwSource).toBe('unknown');
    expect(station.maxKw).toBeNull();
  });

  it('marks status unavailable when StatusType.IsOperational is false', () => {
    const raw = {
      ID: 558,
      AddressInfo: { Title: 'Down Site', Latitude: 1, Longitude: 2 },
      StatusType: { IsOperational: false },
      Connections: [],
    };
    const station = normalizeOcmStation(raw);
    expect(station.status).toBe('unavailable');
  });
});

describe('inferMaxKw', () => {
  it('returns null for connectors/levels with no DC fast signal', () => {
    expect(inferMaxKw(['J1772'], 'level2')).toBeNull();
    expect(inferMaxKw([], undefined)).toBeNull();
  });
  it('returns the conservative DC fast floor for a DC-capable connector', () => {
    expect(inferMaxKw(['TESLA'], undefined)).toBe(50);
    expect(inferMaxKw([], 'dc_fast')).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// min_kw filtering (post-normalization, per DESIGN.md Q2)
// ---------------------------------------------------------------------------

describe('filterStationsByKw', () => {
  const stations = [
    { id: 'a', maxKw: 250, kwSource: 'reported' },
    { id: 'b', maxKw: 150, kwSource: 'reported' },
    { id: 'c', maxKw: 50, kwSource: 'inferred' },
    { id: 'd', maxKw: null, kwSource: 'unknown' },
  ];

  it('filters numerically by min_kw, leaving unknown-kW stations alone', () => {
    const { stations: filtered, counts } = filterStationsByKw(stations, { min_kw: 200 });
    expect(filtered.map((s) => s.id)).toEqual(['a', 'd']); // unknown included by default
    expect(counts).toEqual({ returned: 2, beforeKwFilter: 4, unknownKw: 1 });
  });

  it('drops unknown-kW stations when include_unknown_kw is false', () => {
    const { stations: filtered, counts } = filterStationsByKw(stations, {
      min_kw: 0,
      include_unknown_kw: false,
    });
    expect(filtered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(counts.unknownKw).toBe(1);
    expect(counts.returned).toBe(3);
  });

  it('defaults to min_kw 0 and include_unknown_kw true', () => {
    const { stations: filtered } = filterStationsByKw(stations, {});
    expect(filtered.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

describe('origin allowlist', () => {
  it('parses the default comma-separated origin list', () => {
    const origins = parseAllowedOrigins({});
    expect(origins).toEqual([
      'https://mysimyg.github.io',
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
    expect(DEFAULT_ALLOWED_ORIGINS).toContain('mysimyg.github.io');
  });

  it('parses a custom ALLOWED_ORIGINS env value, trimming whitespace', () => {
    const origins = parseAllowedOrigins({ ALLOWED_ORIGINS: ' https://example.com , https://foo.dev ' });
    expect(origins).toEqual(['https://example.com', 'https://foo.dev']);
  });

  it('allows an exact-match origin', () => {
    const origins = parseAllowedOrigins({});
    expect(isOriginAllowed('https://mysimyg.github.io', origins)).toBe(true);
  });

  it('rejects an origin not on the list', () => {
    const origins = parseAllowedOrigins({});
    expect(isOriginAllowed('https://evil.example.com', origins)).toBe(false);
  });

  it('rejects a missing origin (caller decides whether that is fatal per-route)', () => {
    const origins = parseAllowedOrigins({});
    expect(isOriginAllowed(null, origins)).toBe(false);
    expect(isOriginAllowed(undefined, origins)).toBe(false);
    expect(isOriginAllowed('', origins)).toBe(false);
  });

  it('rejects an origin that is a prefix/substring match but not exact', () => {
    const origins = parseAllowedOrigins({});
    expect(isOriginAllowed('https://mysimyg.github.io.evil.com', origins)).toBe(false);
    expect(isOriginAllowed('http://mysimyg.github.io', origins)).toBe(false); // scheme differs
  });
});

// ---------------------------------------------------------------------------
// Cache key canonicalization
// ---------------------------------------------------------------------------

describe('cache key canonicalization', () => {
  it('sortKeysDeep produces the same structure regardless of key order', () => {
    const a = sortKeysDeep({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = sortKeysDeep({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('canonicalizeJson is independent of object key order', () => {
    const s1 = canonicalizeJson({ min_kw: 250, route: [[1, 2], [3, 4]], connectors: ['TESLA'] });
    const s2 = canonicalizeJson({ connectors: ['TESLA'], route: [[1, 2], [3, 4]], min_kw: 250 });
    expect(s1).toBe(s2);
  });

  it('preserves array element order (order is meaningful for arrays)', () => {
    const s1 = canonicalizeJson({ route: [[1, 2], [3, 4]] });
    const s2 = canonicalizeJson({ route: [[3, 4], [1, 2]] });
    expect(s1).not.toBe(s2);
  });

  it('computeCacheKey yields identical hashes for payloads that differ only in key order', async () => {
    const k1 = await computeCacheKey('POST', '/v1/stations', {
      min_kw: 250,
      route: [[-119.229, 34.274]],
      connectors: ['TESLA', 'J1772COMBO'],
    });
    const k2 = await computeCacheKey('POST', '/v1/stations', {
      connectors: ['TESLA', 'J1772COMBO'],
      route: [[-119.229, 34.274]],
      min_kw: 250,
    });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it('computeCacheKey differs when method, path, or payload differ', async () => {
    const base = { q: 'Ventura, CA' };
    const kGet = await computeCacheKey('GET', '/v1/geocode', base);
    const kPost = await computeCacheKey('POST', '/v1/geocode', base);
    const kOtherPath = await computeCacheKey('GET', '/v1/other', base);
    const kOtherPayload = await computeCacheKey('GET', '/v1/geocode', { q: 'Reno, NV' });
    expect(new Set([kGet, kPost, kOtherPath, kOtherPayload]).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// WKT builder
// ---------------------------------------------------------------------------

describe('buildWkt', () => {
  it('builds a LINESTRING from [lon, lat] points', () => {
    const wkt = buildWkt([
      [-119.229, 34.274],
      [-119.5, 35.0],
      [-118.1745, 35.0525],
    ]);
    expect(wkt).toBe('LINESTRING(-119.229 34.274, -119.5 35, -118.1745 35.0525)');
  });

  it('rejects fewer than 2 points as BAD_REQUEST', () => {
    expect(() => buildWkt([[-119.229, 34.274]])).toThrow(UpstreamError);
    try {
      buildWkt([]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.status).toBe(400);
    }
  });

  it('rejects a route exceeding 300 points as BAD_REQUEST', () => {
    const longRoute = Array.from({ length: 301 }, (_, i) => [-119 + i * 0.001, 35 + i * 0.001]);
    expect(() => buildWkt(longRoute)).toThrow(UpstreamError);
    try {
      buildWkt(longRoute);
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.message).toMatch(/300/);
    }
  });

  it('accepts exactly 300 points', () => {
    const route300 = Array.from({ length: 300 }, (_, i) => [-119 + i * 0.001, 35 + i * 0.001]);
    expect(() => buildWkt(route300)).not.toThrow();
  });

  it('rejects malformed points', () => {
    expect(() => buildWkt([[-119.229, 34.274], ['bad', 1]])).toThrow(UpstreamError);
    expect(() => buildWkt([[-119.229, 34.274], [1]])).toThrow(UpstreamError);
  });
});

describe('buildOrsDirectionsBody', () => {
  it('sets a generous snap radius on both waypoints of a plain 2-point trip', () => {
    // Regression test: a bare Pelias administrative-centroid geocode result
    // (e.g. "Ventura, CA, USA" -> a beach point) previously failed with
    // ORS "Could not find routable point within a radius of 350.0 meters"
    // because no radiuses param was sent at all, so ORS used its tight
    // default. Confirmed live: [-119.29342, 34.262734] -> [-119.98435,
    // 38.93324] 502'd before this fix and 200's after it.
    const body = buildOrsDirectionsBody([
      [-119.29342, 34.262734],
      [-119.98435, 38.93324],
    ]);
    expect(body.coordinates).toEqual([
      [-119.29342, 34.262734],
      [-119.98435, 38.93324],
    ]);
    expect(body.elevation).toBe(true);
    expect(body.radiuses).toHaveLength(2);
    expect(body.radiuses[0]).toBeGreaterThan(350);
    expect(body.radiuses[1]).toBeGreaterThan(350);
  });

  it('sets the same snap radius on every waypoint of a multi-stop trip, not just the two ends (D-030)', () => {
    const waypoints = [
      [-119.29342, 34.262734],
      [-115.1398, 36.1699], // via
      [-96.797, 32.7767], // via
      [-119.29342, 34.262734], // round trip: origin pushed onto the end
    ];
    const body = buildOrsDirectionsBody(waypoints);
    expect(body.coordinates).toEqual(waypoints);
    expect(body.radiuses).toHaveLength(4);
    expect(body.radiuses.every((r) => r >= 5000)).toBe(true);
  });
});

describe('splitIntoLegs', () => {
  // Shape modeled on a real ORS geojson directions response: one combined
  // coordinate array, feature.properties.segments[] (one per leg), each
  // segment's steps carrying way_points [startIdx, endIdx] into that SAME
  // combined array. This is the entire mechanism phase 6 relies on to hand
  // the (untouched) planner one two-point-equivalent route per leg.
  const coords = [
    [-119.3, 34.3, 10],
    [-119.1, 34.6, 20],
    [-118.9, 34.9, 30], // via boundary -- shared by leg 1's end and leg 2's start
    [-118.5, 35.2, 40],
    [-118.0, 35.6, 50],
  ];

  it('slices each leg from its own steps way_points, sharing the via boundary index', () => {
    const segments = [
      {
        distance: 1000,
        duration: 100,
        steps: [
          { way_points: [0, 1] },
          { way_points: [1, 2] },
        ],
      },
      {
        distance: 2000,
        duration: 200,
        steps: [
          { way_points: [2, 3] },
          { way_points: [3, 4] },
        ],
      },
    ];
    const legs = splitIntoLegs(coords, segments);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toEqual({ distance_m: 1000, duration_s: 100, geometry: coords.slice(0, 3) });
    expect(legs[1]).toEqual({ distance_m: 2000, duration_s: 200, geometry: coords.slice(2, 5) });
    // The via point (index 2) is the shared boundary -- present at the end
    // of leg 1's geometry AND the start of leg 2's, not dropped or doubled
    // in a way that would put a gap in the combined route.
    expect(legs[0].geometry[legs[0].geometry.length - 1]).toEqual(legs[1].geometry[0]);
  });

  it('returns one leg spanning everything for a plain 2-point trip (the N=2 case)', () => {
    const segments = [{ distance: 5000, duration: 500, steps: [{ way_points: [0, 4] }] }];
    const legs = splitIntoLegs(coords, segments);
    expect(legs).toHaveLength(1);
    expect(legs[0].geometry).toEqual(coords);
  });

  it('falls back to the full coordinate span if a segment has no steps', () => {
    const legs = splitIntoLegs(coords, [{ distance: 5000, duration: 500, steps: [] }]);
    expect(legs[0].geometry).toEqual(coords);
  });

  it('returns an empty array for no segments', () => {
    expect(splitIntoLegs(coords, undefined)).toEqual([]);
    expect(splitIntoLegs(coords, [])).toEqual([]);
  });
});
