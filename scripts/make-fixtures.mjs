/**
 * Generates the frozen planner fixtures in test/fixtures/.
 *
 * IMPORTANT, read before trusting these numbers:
 * These are SYNTHETIC fixtures. Waypoint coordinates and elevations
 * approximate real places on the corridor, and the station list approximates
 * known DC fast charging sites, but this is NOT captured live API data.
 * They exist so the phase 3 gate is reproducible offline and burns no NREL
 * quota. Once the NREL and ORS keys exist, capture real responses and replace
 * these -- see DESIGN.md §7.
 *
 * Deterministic: no clock, no randomness, stable ordering.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'test', 'fixtures')
mkdirSync(outDir, { recursive: true })

// [lon, lat, elevation_m, label]
const US395 = [
  [-119.2290, 34.2746, 30, 'Ventura'],
  [-118.8760, 34.3600, 200, 'Santa Paula gap'],
  [-118.5426, 34.3917, 380, 'Santa Clarita'],
  [-118.3200, 34.5200, 560, 'Vincent'],
  [-118.1542, 34.6868, 716, 'Lancaster'],
  [-118.1745, 35.0525, 835, 'Mojave'],
  [-117.9800, 35.4000, 690, 'Red Rock'],
  [-117.8120, 35.6480, 745, 'Inyokern'],
  [-117.9700, 36.2000, 1080, 'Owens Lake'],
  [-118.0620, 36.6060, 1130, 'Lone Pine'],
  [-118.1990, 36.8030, 1204, 'Independence'],
  [-118.2900, 37.1650, 1204, 'Big Pine'],
  [-118.3950, 37.3630, 1256, 'Bishop'],
  [-118.6500, 37.5400, 2100, 'Sherwin Grade'],
  [-118.9500, 37.7300, 2438, 'Deadman Summit'],
  [-119.1190, 37.9560, 2065, 'Lee Vining'],
  [-119.1800, 38.1000, 2200, 'Conway Summit'],
  [-119.2300, 38.2560, 1975, 'Bridgeport'],
  [-119.4200, 38.5000, 2100, 'Devils Gate'],
  [-119.5400, 38.6800, 1560, 'Topaz'],
  [-119.7490, 38.9410, 1450, 'Gardnerville'],
  [-119.7670, 39.1638, 1440, 'Carson City'],
]
const TO_TAHOE = [
  [-119.8940, 39.1080, 2210, 'Spooner Summit'],
  [-119.9772, 38.9399, 1900, 'South Lake Tahoe'],
]
const TO_RENO = [[-119.8138, 39.5296, 1373, 'Reno']]

/** Densify a waypoint list into ~2 km segments with linear elevation. */
function densify(waypoints, stepM = 2000) {
  const out = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [lon0, lat0, e0] = waypoints[i]
    const [lon1, lat1, e1] = waypoints[i + 1]
    const d = haversine([lon0, lat0], [lon1, lat1])
    const n = Math.max(1, Math.round(d / stepM))
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push([
        round6(lon0 + (lon1 - lon0) * t),
        round6(lat0 + (lat1 - lat0) * t),
        Math.round(e0 + (e1 - e0) * t),
      ])
    }
  }
  const last = waypoints[waypoints.length - 1]
  out.push([round6(last[0]), round6(last[1]), Math.round(last[2])])
  return out
}

function haversine(a, b) {
  const R = 6371008.8
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function geomLength(g) {
  let m = 0
  for (let i = 1; i < g.length; i++) m += haversine(g[i - 1], g[i])
  return m
}

const round6 = (n) => Math.round(n * 1e6) / 1e6

/**
 * Approximate DC fast charging sites on the corridor.
 * NOT live AFDC data. maxKw/kwSource chosen to exercise the planner's paths,
 * including one station with genuinely unknown power.
 */
const STATIONS = [
  st('afdc:mojave', 'Mojave Supercharger', 'Tesla', -118.1580, 35.0510, 250),
  st('afdc:lonepine', 'Lone Pine Supercharger', 'Tesla', -118.0630, 36.6040, 250),
  st('afdc:bigpine', 'Big Pine Supercharger', 'Tesla', -118.2920, 37.1660, 150),
  st('afdc:bishop-sc', 'Bishop Supercharger', 'Tesla', -118.3960, 37.3650, 250),
  st('afdc:bishop-ea', 'Bishop Electrify America', 'Electrify America', -118.3930, 37.3690, 350),
  st('afdc:mammoth', 'Mammoth Lakes Supercharger', 'Tesla', -118.9720, 37.6480, 250),
  st('afdc:leevining', 'Lee Vining Town Lot', 'Non-Networked', -119.1180, 37.9570, null, 'unknown'),
  st('afdc:gardnerville', 'Gardnerville EVgo', 'EVgo', -119.7500, 38.9420, 200),
  st('afdc:carson', 'Carson City Supercharger', 'Tesla', -119.7690, 39.1620, 250),
  st('afdc:slt', 'South Lake Tahoe Supercharger', 'Tesla', -119.9760, 38.9420, 250),
  st('afdc:reno-ea', 'Reno Electrify America', 'Electrify America', -119.8120, 39.5280, 350),
]

function st(id, name, network, lon, lat, maxKw, kwSource) {
  return {
    id,
    source: 'afdc',
    name,
    network,
    lat,
    lon,
    address: null,
    access: 'public',
    status: 'E',
    connectors: network === 'Tesla' ? ['TESLA', 'J1772COMBO'] : ['J1772COMBO', 'CHADEMO'],
    maxKw,
    kwSource: kwSource ?? 'reported',
    portCount: 8,
    pricing: null,
    url: null,
  }
}

function makeRoute(waypoints, avgMph) {
  const geometry = densify(waypoints)
  const distance_m = geomLength(geometry)
  // Sinuosity: a straight waypoint path understates real road distance.
  const roadFactor = 1.1
  const miles = (distance_m * roadFactor) / 1609.344
  return {
    distance_m: Math.round(distance_m),
    duration_s: Math.round((miles / avgMph) * 3600),
    geometry,
    elevationAvailable: true,
  }
}

const tahoe = makeRoute([...US395, ...TO_TAHOE], 55)
const reno = makeRoute([...US395, ...TO_RENO], 57)

const note =
  'SYNTHETIC fixture, not live API data. Approximates the real corridor for reproducible offline tests. Replace with captured live responses once API keys exist.'

writeFileSync(
  join(outDir, 'route-ventura-southlaketahoe.json'),
  JSON.stringify({ _note: note, name: 'Ventura -> South Lake Tahoe (US-395)', route: tahoe }, null, 2) + '\n'
)
writeFileSync(
  join(outDir, 'route-ventura-reno.json'),
  JSON.stringify({ _note: note, name: 'Ventura -> Reno (US-395)', route: reno }, null, 2) + '\n'
)
writeFileSync(
  join(outDir, 'stations-us395.json'),
  JSON.stringify({ _note: note, stations: STATIONS }, null, 2) + '\n'
)

console.log('tahoe:', (tahoe.distance_m / 1609.344).toFixed(0), 'mi,', (tahoe.duration_s / 3600).toFixed(1), 'h,', tahoe.geometry.length, 'pts')
console.log('reno: ', (reno.distance_m / 1609.344).toFixed(0), 'mi,', (reno.duration_s / 3600).toFixed(1), 'h,', reno.geometry.length, 'pts')
