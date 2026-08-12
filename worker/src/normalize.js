// worker/src/normalize.js
//
// Pure normalization of upstream station records (AFDC + OpenChargeMap)
// into the shared `Station` shape from DESIGN.md §4.2. No network I/O here
// so this file is directly unit-testable.

// Connector strings we recognize as DC fast capable, used only for the
// conservative kW inference path (kwSource: "inferred").
const DC_FAST_CONNECTORS = new Set(['TESLA', 'CHADEMO', 'J1772COMBO', 'CCS', 'CCS1', 'CCS2']);

// Conservative inferred power for a DC fast connector with no reported
// power_kw. Deliberately low (below the lowest common public DC fast rate)
// so an inferred value never overstates a station and misleads the planner.
const INFERRED_DC_FAST_KW = 50;

/**
 * Guess a maxKw when no reported power figure exists, from connector types
 * and/or the AFDC "level" bucket. Returns null when nothing can be safely
 * inferred (e.g. Level 2 only, or no connector info at all).
 * @param {string[]} connectors
 * @param {string|undefined} level - 'dc_fast' | 'level2' | 'level1' | undefined
 */
export function inferMaxKw(connectors, level) {
  const list = Array.isArray(connectors) ? connectors : [];
  const hasDcFastConnector = list.some((c) => DC_FAST_CONNECTORS.has(String(c).toUpperCase()));
  if (level === 'dc_fast' || hasDcFastConnector) {
    return INFERRED_DC_FAST_KW;
  }
  return null;
}

function round(n, digits) {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Pull every reported power_kw out of an AFDC `ev_charging_units[]` array.
 * The live (2026) `nearby-route` response nests power by connector type:
 *   unit.connectors = { TESLA: {power_kw, port_count}, J1772COMBO: {...}, ... }
 * DESIGN.md §2.1 describes a flatter `unit.power_kw` shape, which does not
 * match what the API actually returns (verified against developer.nlr.gov
 * live traffic) — support both defensively, nested is what's real.
 */
function collectAfdcReportedKw(units) {
  const kws = [];
  for (const u of units) {
    if (!u) continue;
    if (typeof u.power_kw === 'number' && u.power_kw > 0) kws.push(u.power_kw);
    if (u.connectors && typeof u.connectors === 'object') {
      for (const c of Object.values(u.connectors)) {
        if (c && typeof c.power_kw === 'number' && c.power_kw > 0) kws.push(c.power_kw);
      }
    }
  }
  return kws;
}

/**
 * Normalize a raw NREL AFDC fuel_stations[] record into a Station.
 * @param {object} raw
 */
export function normalizeAfdcStation(raw) {
  raw = raw || {};
  const connectors = Array.isArray(raw.ev_connector_types) ? raw.ev_connector_types.map(String) : [];
  const units = Array.isArray(raw.ev_charging_units) ? raw.ev_charging_units : [];
  const reportedKws = collectAfdcReportedKw(units);

  let maxKw = null;
  let kwSource = 'unknown';
  if (reportedKws.length) {
    maxKw = Math.max(...reportedKws);
    kwSource = 'reported';
  } else {
    const level = Number(raw.ev_dc_fast_num) > 0 ? 'dc_fast' : undefined;
    const inferred = inferMaxKw(connectors, level);
    if (inferred != null) {
      maxKw = inferred;
      kwSource = 'inferred';
    }
  }

  const addressParts = [raw.street_address, raw.city, raw.state, raw.zip].filter(Boolean);
  const portCount =
    (Number(raw.ev_dc_fast_num) || 0) + (Number(raw.ev_level2_evse_num) || 0);

  return {
    id: `afdc:${raw.id ?? 'unknown'}`,
    source: 'afdc',
    name: raw.station_name || 'Unknown Station',
    network: raw.ev_network || null,
    lat: typeof raw.latitude === 'number' ? raw.latitude : null,
    lon: typeof raw.longitude === 'number' ? raw.longitude : null,
    address: addressParts.length ? addressParts.join(', ') : null,
    access: raw.access_code === 'private' ? 'private' : 'public',
    status: raw.status_code || 'unknown',
    connectors,
    maxKw,
    kwSource,
    portCount: portCount > 0 ? portCount : null,
    pricing: raw.ev_pricing ?? null,
    url: raw.station_url ?? null,
    distanceAlongRoute_m: null,
  };
}

const OCM_CONNECTOR_MAP = [
  [/tesla/i, 'TESLA'],
  [/ccs|combo/i, 'J1772COMBO'],
  [/chademo/i, 'CHADEMO'],
  [/j1772|type ?1/i, 'J1772'],
  [/type ?2|mennekes/i, 'TYPE2'],
];

function mapOcmConnectorType(title) {
  if (!title) return null;
  for (const [re, code] of OCM_CONNECTOR_MAP) {
    if (re.test(title)) return code;
  }
  return String(title).toUpperCase().replace(/\s+/g, '_');
}

/**
 * Normalize a raw OpenChargeMap POI record into a Station.
 * @param {object} raw
 */
export function normalizeOcmStation(raw) {
  raw = raw || {};
  const conns = Array.isArray(raw.Connections) ? raw.Connections : [];
  const reportedKws = conns
    .map((c) => (c && typeof c.PowerKW === 'number' ? c.PowerKW : null))
    .filter((v) => v != null && v > 0);
  const connectors = conns
    .map((c) => mapOcmConnectorType(c && c.ConnectionType && (c.ConnectionType.Title || c.ConnectionType.FormalName)))
    .filter(Boolean);

  let maxKw = null;
  let kwSource = 'unknown';
  if (reportedKws.length) {
    maxKw = Math.max(...reportedKws);
    kwSource = 'reported';
  } else {
    const isDcFast = conns.some(
      (c) => c && c.Level && (c.Level.IsFastChargeCapable || /dc/i.test(c.Level.Title || ''))
    );
    const inferred = inferMaxKw(connectors, isDcFast ? 'dc_fast' : undefined);
    if (inferred != null) {
      maxKw = inferred;
      kwSource = 'inferred';
    }
  }

  const addr = raw.AddressInfo || {};
  const addressParts = [addr.AddressLine1, addr.Town, addr.StateOrProvince, addr.Postcode].filter(Boolean);
  const isOperational = raw.StatusType ? raw.StatusType.IsOperational : true;

  return {
    id: `ocm:${raw.ID ?? 'unknown'}`,
    source: 'ocm',
    name: addr.Title || 'Unknown Station',
    network: (raw.OperatorInfo && raw.OperatorInfo.Title) || null,
    lat: typeof addr.Latitude === 'number' ? round(addr.Latitude, 6) : null,
    lon: typeof addr.Longitude === 'number' ? round(addr.Longitude, 6) : null,
    address: addressParts.length ? addressParts.join(', ') : null,
    access: raw.UsageType && raw.UsageType.IsMembershipRequired ? 'membership' : 'public',
    status: isOperational === false ? 'unavailable' : 'E',
    connectors,
    maxKw,
    kwSource,
    portCount: typeof raw.NumberOfPoints === 'number' ? raw.NumberOfPoints : conns.length || null,
    pricing: raw.UsageCost ?? null,
    url: addr.RelatedURL ?? null,
    distanceAlongRoute_m: null,
  };
}

/**
 * Apply the min_kw filter *after* normalization (never pass ev_power_kw_min
 * upstream — see DESIGN.md Q2). kwSource:"unknown" stations are kept or
 * dropped as a group via include_unknown_kw, independent of the numeric
 * threshold since they have no number to compare.
 * @param {Array} stations - normalized Station[]
 * @param {{min_kw?: number, include_unknown_kw?: boolean}} opts
 */
export function filterStationsByKw(stations, opts = {}) {
  const minKw = typeof opts.min_kw === 'number' && !Number.isNaN(opts.min_kw) ? opts.min_kw : 0;
  const includeUnknown = opts.include_unknown_kw !== false; // default true
  const list = Array.isArray(stations) ? stations : [];

  const beforeKwFilter = list.length;
  const unknownKw = list.filter((s) => s.kwSource === 'unknown').length;

  const filtered = list.filter((s) => {
    if (s.kwSource === 'unknown') return includeUnknown;
    return typeof s.maxKw === 'number' && s.maxKw >= minKw;
  });

  return {
    stations: filtered,
    counts: {
      returned: filtered.length,
      beforeKwFilter,
      unknownKw,
    },
  };
}
