#!/usr/bin/env node
/**
 * Builds public/data/sleep-<category>.geojson and public/data/sleep-index.json
 * from the raw, hand-retrieved records in scripts/sources/*.json.
 *
 * This script owns no research judgment -- every record in scripts/sources/
 * already carries its own provenance (source, sourceUrl, confirmed date,
 * verified flag). This script's only jobs are: aggregate, validate hard
 * against the DESIGN.md §4.6 schema, sort deterministically, and emit.
 *
 * It fails loudly (non-zero exit, thrown Error) on:
 *   - a missing/empty id, name, category, notes, confirmed, source, or sourceUrl
 *   - a duplicate id across all source files
 *   - a missing or non-numeric coordinate
 *   - a coordinate outside the CA/NV bounding box
 *   - a confirmed date that isn't a valid ISO YYYY-MM-DD date
 *   - a category outside the v0 allowlist (cracker-barrel, rest-area, casino)
 *     -- "blm" is explicitly phase 2 / icebox per DESIGN.md and must never
 *     be built by this script, even if a source file contains one.
 *   - a verified field that isn't a strict boolean
 *
 * Deterministic: no Date.now(), no random ids, no host-dependent readdir
 * order relied upon -- everything is sorted by id before it's written, and
 * JSON.stringify is used with a fixed key order per feature.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourcesDir = join(here, 'sources')
const outDir = join(here, '..', 'public', 'data')

// v0 categories only. "blm" is phase 2 / icebox -- DESIGN.md §4.6 -- and is
// deliberately excluded from this allowlist so a stray record can never slip
// through, even if someone drops a blm-tagged source file in by mistake.
const CATEGORY_META = {
  'cracker-barrel': { label: 'Cracker Barrel', icon: 'utensils', color: '#d99a4e' },
  'rest-area': { label: 'Rest Area', icon: 'parking-circle', color: '#4ea1d9' },
  casino: { label: 'Casino', icon: 'dice-5', color: '#b967ff' },
}

// Loose CA/NV bounding box, generous enough to not clip real corridor points
// but tight enough to catch a swapped lat/lon or a typo'd digit.
const BBOX = { minLon: -124.6, maxLon: -113.9, minLat: 32.0, maxLat: 42.1 }

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function fail(message) {
  throw new Error(`[build-sleep-geojson] ${message}`)
}

function assertNonEmptyString(value, field, context) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${context}: "${field}" must be a non-empty string, got ${JSON.stringify(value)}`)
  }
}

function assertIsoDate(value, context) {
  assertNonEmptyString(value, 'confirmed', context)
  if (!ISO_DATE_RE.test(value)) {
    fail(`${context}: "confirmed" must be an ISO YYYY-MM-DD date, got ${JSON.stringify(value)}`)
  }
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  if (!valid) {
    fail(`${context}: "confirmed" is not a real calendar date: ${JSON.stringify(value)}`)
  }
}

function assertCoordinate(lat, lon, context) {
  if (typeof lat !== 'number' || Number.isNaN(lat)) {
    fail(`${context}: "lat" must be a number, got ${JSON.stringify(lat)}`)
  }
  if (typeof lon !== 'number' || Number.isNaN(lon)) {
    fail(`${context}: "lon" must be a number, got ${JSON.stringify(lon)}`)
  }
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
    fail(
      `${context}: coordinate [${lon}, ${lat}] is outside the CA/NV bounding box ` +
        `[${BBOX.minLon}, ${BBOX.minLat}] - [${BBOX.maxLon}, ${BBOX.maxLat}]`
    )
  }
}

function loadSourceFiles() {
  let entries
  try {
    entries = readdirSync(sourcesDir)
  } catch (err) {
    fail(`could not read sources directory ${sourcesDir}: ${err.message}`)
  }
  const files = entries.filter((f) => f.endsWith('.json')).sort()
  if (files.length === 0) {
    fail(`no *.json source files found in ${sourcesDir}`)
  }
  return files
}

function loadRecords() {
  const files = loadSourceFiles()
  const records = []
  for (const file of files) {
    const fullPath = join(sourcesDir, file)
    let parsed
    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf8'))
    } catch (err) {
      fail(`${file}: invalid JSON (${err.message})`)
    }
    if (!Array.isArray(parsed.records)) {
      fail(`${file}: expected a top-level "records" array`)
    }
    for (const record of parsed.records) {
      records.push({ ...record, __file: file })
    }
  }
  return records
}

function validateAndNormalize(records) {
  const seenIds = new Map()
  const features = []

  for (const record of records) {
    const context = `${record.__file} / id=${record.id ?? '<missing>'}`

    assertNonEmptyString(record.id, 'id', context)
    if (seenIds.has(record.id)) {
      fail(`${context}: duplicate id "${record.id}" also defined in ${seenIds.get(record.id)}`)
    }
    seenIds.set(record.id, record.__file)

    assertNonEmptyString(record.name, 'name', context)
    assertNonEmptyString(record.category, 'category', context)
    if (!Object.prototype.hasOwnProperty.call(CATEGORY_META, record.category)) {
      fail(
        `${context}: category "${record.category}" is not a v0 category ` +
          `(allowed: ${Object.keys(CATEGORY_META).join(', ')}). ` +
          `"blm" is phase 2 / icebox per DESIGN.md and must not be built.`
      )
    }
    assertNonEmptyString(record.notes, 'notes', context)
    assertIsoDate(record.confirmed, context)
    assertNonEmptyString(record.source, 'source', context)
    assertNonEmptyString(record.sourceUrl, 'sourceUrl', context)
    if (!/^https?:\/\//.test(record.sourceUrl)) {
      fail(`${context}: "sourceUrl" does not look like a URL: ${JSON.stringify(record.sourceUrl)}`)
    }
    if (typeof record.verified !== 'boolean') {
      fail(`${context}: "verified" must be a boolean, got ${JSON.stringify(record.verified)}`)
    }
    assertCoordinate(record.lat, record.lon, context)
    if (record.ioverlanderUrl != null) {
      assertNonEmptyString(record.ioverlanderUrl, 'ioverlanderUrl', context)
    }

    const properties = {
      id: record.id,
      name: record.name,
      category: record.category,
      notes: record.notes,
      confirmed: record.confirmed,
      source: record.source,
      sourceUrl: record.sourceUrl,
      verified: record.verified,
    }
    if (record.ioverlanderUrl != null) {
      properties.ioverlanderUrl = record.ioverlanderUrl
    }

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [record.lon, record.lat] },
      properties,
    })
  }

  // Stable, deterministic order regardless of source file read order.
  features.sort((a, b) => (a.properties.id < b.properties.id ? -1 : a.properties.id > b.properties.id ? 1 : 0))
  return features
}

function groupByCategory(features) {
  const byCategory = new Map()
  for (const feature of features) {
    const cat = feature.properties.category
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat).push(feature)
  }
  return byCategory
}

function writeGeoJson(category, features) {
  mkdirSync(outDir, { recursive: true })
  const fileName = `sleep-${category}.geojson`
  const collection = { type: 'FeatureCollection', features }
  // Fixed 2-space formatting, stable key order (already fixed by construction
  // order above) -- no timestamps, no environment-dependent values.
  writeFileSync(join(outDir, fileName), JSON.stringify(collection, null, 2) + '\n')
  return fileName
}

function writeIndex(categoriesPresent) {
  const index = Object.keys(CATEGORY_META)
    .filter((cat) => categoriesPresent.has(cat))
    .map((cat) => ({
      category: cat,
      label: CATEGORY_META[cat].label,
      file: `sleep-${cat}.geojson`,
      icon: CATEGORY_META[cat].icon,
      color: CATEGORY_META[cat].color,
    }))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'sleep-index.json'), JSON.stringify(index, null, 2) + '\n')
  return index
}

function main() {
  const records = loadRecords()
  const features = validateAndNormalize(records)
  const byCategory = groupByCategory(features)

  const summary = []
  for (const [category, catFeatures] of [...byCategory.entries()].sort()) {
    const fileName = writeGeoJson(category, catFeatures)
    const verifiedCount = catFeatures.filter((f) => f.properties.verified).length
    summary.push(`  ${category}: ${catFeatures.length} pins -> ${fileName} (${verifiedCount} verified)`)
  }

  const index = writeIndex(new Set(byCategory.keys()))

  console.log(`[build-sleep-geojson] wrote ${byCategory.size} category file(s):`)
  console.log(summary.join('\n'))
  console.log(`[build-sleep-geojson] wrote sleep-index.json with ${index.length} entries`)
}

main()
