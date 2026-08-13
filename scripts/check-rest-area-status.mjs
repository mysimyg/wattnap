#!/usr/bin/env node
/**
 * Cross-checks EVERY rest-area record in scripts/sources/ against Caltrans'
 * LIVE open/closed feed, and reports drift in BOTH directions.
 *
 * Why this exists: on 2026-08-12 a research pass found that five rest-area
 * pins we shipped as `verified: true` were in fact closed for construction --
 * including Tejon Pass, which at the time was the ONLY coverage within 5
 * miles of the entire 491-mile Ventura->Tahoe route. Sending a tired driver
 * to a locked gate at 2am is a worse failure than showing nothing.
 *
 * `verified` answers "was this real when we checked?", which decays. This
 * answers "is it open right now?" -- so the staleness is measurable instead
 * of invisible.
 *
 * It reads the SOURCES, not the built GeoJSON. An earlier version read the
 * built output, which meant a record suppressed by status:"closed" was
 * invisible to it and could never be seen to reopen -- exactly how Gold Run
 * westbound stayed hidden after it came back. Both directions matter: a
 * closure we missed strands someone, a reopening we missed quietly costs a
 * stop.
 *
 * The static Caltrans GIS export does NOT carry status; only this KML feed
 * does. Network required, so this is a maintenance tool, not a unit test.
 *
 * Usage:
 *   node scripts/check-rest-area-status.mjs
 *   node scripts/check-rest-area-status.mjs --json
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourcesDir = join(here, '..', 'scripts', 'sources')

const FEED_URL = 'https://quickmap.dot.ca.gov/data/srra.kml'

/** Strip HTML/entities and collapse whitespace for name comparison. */
function normalizeName(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/\b(safety )?roadside rest area\b/g, '')
    .replace(/\brest area\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function parseFeed(kml) {
  const out = []
  for (const pm of kml.match(/<Placemark[\s\S]*?<\/Placemark>/g) || []) {
    const title = pm.match(/iw-title">([\s\S]*?)<\/h2>/)
    const status = pm.match(/<strong>Status:<\/strong>[\s\S]*?>(Open|Closed)</)
    if (!title) continue
    const rawName = title[1].replace(/<[^>]*>/g, '').trim()
    out.push({
      rawName,
      key: normalizeName(rawName),
      status: status ? status[1] : 'Unknown',
    })
  }
  return out
}

/**
 * Every rest-area record in the SOURCES, not just the ones that ship.
 *
 * Reading the built GeoJSON was a real blind spot: a record suppressed by
 * status:"closed" never appears there, so once suppressed it could never be
 * seen to reopen. Gold Run westbound was hidden that way from 2026-08-12
 * until a manual re-check on 08-13. Drift runs in both directions, so the
 * check has to look at both.
 */
export function loadSourceRestAreas(dir = sourcesDir) {
  const records = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    for (const r of parsed.records ?? []) {
      if (r.category !== 'rest-area') continue
      records.push({
        id: r.id,
        name: r.name,
        key: normalizeName(r.name),
        verified: r.verified,
        status: r.status ?? 'open',
        file,
      })
    }
  }
  return records
}

const DIRECTIONS = ['northbound', 'southbound', 'eastbound', 'westbound']

/** Direction token in a name, if any. Gold Run is open one way and closed the
 * other, so ignoring direction would wrongly condemn a working facility. */
function directionOf(name) {
  const low = name.toLowerCase()
  return DIRECTIONS.find((d) => low.includes(d)) ?? null
}

/** A shipped pin matches a feed entry by place name AND, when both state one,
 * by direction. */
export function matchStatus(pin, feed) {
  const pinDir = directionOf(pin.name)
  const placeKey = (k) => k.replace(new RegExp(`\\b(${DIRECTIONS.join('|')})\\b`, 'g'), '').trim()
  const a = placeKey(pin.key)

  const hits = feed.filter((f) => {
    if (!f.key || !pin.key) return false
    const b = placeKey(f.key)
    const nameMatch = a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0]
    if (!nameMatch) return false
    const feedDir = directionOf(f.rawName)
    // Only enforce direction when BOTH sides declare one; Caltrans sometimes
    // combines both directions into a single record.
    if (pinDir && feedDir) return pinDir === feedDir
    return true
  })
  if (!hits.length) return { matched: false, status: 'Unknown', matches: [] }
  const anyClosed = hits.some((h) => h.status === 'Closed')
  const allClosed = hits.every((h) => h.status === 'Closed')
  return {
    matched: true,
    status: allClosed ? 'Closed' : anyClosed ? 'Partial' : 'Open',
    matches: hits,
  }
}

async function main() {
  const asJson = process.argv.includes('--json')
  const res = await fetch(FEED_URL)
  if (!res.ok) {
    console.error(`feed fetch failed: HTTP ${res.status}`)
    process.exit(2)
  }
  const feed = parseFeed(await res.text())
  const records = loadSourceRestAreas()

  const report = records.map((p) => {
    const m = matchStatus(p, feed)
    const closedUpstream = m.status === 'Closed' || m.status === 'Partial'
    let problem = null
    if (closedUpstream && p.status !== 'closed') {
      problem = 'SHIPPED AS AVAILABLE BUT CLOSED UPSTREAM'
    } else if (m.status === 'Open' && p.status === 'closed') {
      // The direction that used to be invisible.
      problem = 'SUPPRESSED AS CLOSED BUT REOPENED UPSTREAM -- restore it'
    }
    return {
      id: p.id,
      name: p.name,
      recordStatus: p.status,
      liveStatus: m.status,
      matched: m.matched,
      problem,
    }
  })

  if (asJson) {
    console.log(JSON.stringify({ feedCount: feed.length, report }, null, 2))
    return
  }

  console.log(
    `\nCaltrans live status — ${feed.length} facilities in feed, ` +
      `${records.length} rest-area records in scripts/sources/\n`
  )
  for (const r of report) {
    const tag = r.problem ? '  ** ' + r.problem : ''
    const shown = r.recordStatus === 'closed' ? 'suppressed' : 'shipping'
    console.log(`  [${r.liveStatus.padEnd(7)}] ${shown.padEnd(10)} ${r.name}${tag}`)
  }
  const problems = report.filter((r) => r.problem)
  console.log(
    problems.length
      ? `\n${problems.length} pin(s) need attention.\n`
      : `\nNo drift: every open record ships, every suppressed record is still closed.\n`
  )
  if (problems.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
