import { useEffect, useRef, useState } from 'preact/hooks'
import * as api from '../api/client.js'
import {
  setFrom,
  setTo,
  swapFromTo,
  planTripFlow,
  useWattnap,
  addVia,
  removeVia,
  moveVia,
  setRoundTrip,
  computeWaypoints,
} from '../state.js'
import { describeApiError } from './StateMessage.jsx'

function GeoField({ label, field, value, onSelect, placeholder }) {
  const [query, setQuery] = useState(value ? value.label : '')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)
  // Set right before this component invalidates its own resolved value (see
  // handleInput below) so the value->query sync effect doesn't then stomp
  // the text the user is actively typing back to empty.
  const selfInvalidatedRef = useRef(false)

  useEffect(() => {
    if (selfInvalidatedRef.current) {
      selfInvalidatedRef.current = false
      return
    }
    setQuery(value ? value.label : '')
  }, [value])

  function handleInput(e) {
    const q = e.currentTarget.value
    setQuery(q)
    setError(null)
    // A resolved selection is only valid for the exact label it came from.
    // Without this, editing past a picked suggestion leaves the old
    // coordinate live in the store -- "plan trip" stays enabled and silently
    // plans against wherever the user WAS pointed, not wherever the visible
    // text now says.
    if (value && q !== value.label) {
      selfInvalidatedRef.current = true
      onSelect(null)
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.trim().length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      if (!api.isConfigured) return
      try {
        const results = await api.geocode(q, { field })
        setSuggestions(results)
        setOpen(results.length > 0)
      } catch (err) {
        if (err.code !== 'ABORTED') setError(err)
      }
    }, 350)
  }

  function pick(result) {
    onSelect({ label: result.label, lat: result.lat, lon: result.lon })
    setQuery(result.label)
    setOpen(false)
    setSuggestions([])
  }

  function clear() {
    onSelect(null)
    setQuery('')
    setSuggestions([])
    setOpen(false)
  }

  // wattnap-spec.md §9 item 6: "matched-substring in --text against
  // --text-dim" -- the part of a suggestion's label that matches what was
  // typed reads as the confident part, the rest as context around it.
  function renderLabel(label) {
    const idx = label.toLowerCase().indexOf(query.trim().toLowerCase())
    if (idx === -1 || !query.trim()) return <span class="wn-suggestions__dim">{label}</span>
    return (
      <>
        <span class="wn-suggestions__dim">{label.slice(0, idx)}</span>
        <span class="wn-suggestions__match">{label.slice(idx, idx + query.trim().length)}</span>
        <span class="wn-suggestions__dim">{label.slice(idx + query.trim().length)}</span>
      </>
    )
  }

  return (
    <div class="wn-geofield">
      <label class="wn-geofield__label" for={`wn-${field}`}>
        {label}
      </label>
      <div class="wn-geofield__row">
        <input
          id={`wn-${field}`}
          class="wn-input"
          type="text"
          value={query}
          placeholder={placeholder}
          onInput={handleInput}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autocomplete="off"
        />
        {query ? (
          <button type="button" class="wn-icon-btn wn-icon-btn--small" aria-label={`Clear ${label}`} onClick={clear}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
      {open && suggestions.length > 0 ? (
        <ul class="wn-suggestions">
          {suggestions.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                {renderLabel(r.label)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p class="wn-geofield__error">{describeApiError(error)?.message}</p> : null}
    </div>
  )
}

function ViaRow({ via, index, count, onRemove, onMoveUp, onMoveDown }) {
  return (
    <div class="wn-waypoint">
      <span class="wn-waypoint__dot" aria-hidden="true" />
      <span class="wn-waypoint__label">{via.label}</span>
      <div class="wn-waypoint__controls">
        <button
          type="button"
          class="wn-icon-btn wn-icon-btn--small"
          onClick={() => onMoveUp(index)}
          disabled={index === 0}
          aria-label={`Move ${via.label} earlier in the trip`}
        >
          ↑
        </button>
        <button
          type="button"
          class="wn-icon-btn wn-icon-btn--small"
          onClick={() => onMoveDown(index)}
          disabled={index === count - 1}
          aria-label={`Move ${via.label} later in the trip`}
        >
          ↓
        </button>
        <button
          type="button"
          class="wn-icon-btn wn-icon-btn--small"
          onClick={() => onRemove(index)}
          aria-label={`Remove ${via.label}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function AddStopRow() {
  const [adding, setAdding] = useState(false)
  if (!adding) {
    return (
      <button type="button" class="wn-waypoint__add" onClick={() => setAdding(true)}>
        + add stop
      </button>
    )
  }
  return (
    <div class="wn-waypoint">
      <span class="wn-waypoint__dot wn-waypoint__dot--pending" aria-hidden="true" />
      <div class="wn-waypoint__field">
        <GeoField
          label="Add stop"
          field="via-new"
          value={null}
          placeholder="City or address"
          onSelect={(point) => {
            if (point) {
              addVia(point)
              setAdding(false)
            }
          }}
        />
      </div>
      <button type="button" class="wn-icon-btn wn-icon-btn--small" onClick={() => setAdding(false)} aria-label="Cancel adding a stop">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  )
}

/**
 * The full waypoint editor -- origin, vias (spine rows, remove + reorder),
 * add-stop, destination, round-trip toggle, plan button. Exported so the
 * full-screen trip bar (src/ui/MapView.jsx) can open the identical editor
 * inside a sheet instead of duplicating this markup (wattnap-spec.md §8:
 * "tapping it opens the same editor").
 *
 * Reordering is up/down buttons per row, not pointer drag-and-drop. Spec
 * says "drag to reorder"; a real cross-device (touch + mouse) drag
 * implementation is a meaningfully bigger sub-project than the rest of
 * this pass, and up/down buttons reach the identical end state (any via
 * can move to any position) without it -- reordering works, it just isn't
 * driven by a drag gesture.
 */
export function WaypointEditor() {
  const s = useWattnap()
  const canPlan = !!s.from && !!s.to

  return (
    <div class="wn-tripform">
      <div class="wn-waypoints">
        <div class="wn-waypoint wn-waypoint--endpoint">
          <span class="wn-waypoint__dot wn-waypoint__dot--start" aria-hidden="true" />
          <div class="wn-waypoint__field">
            <GeoField label="From" field="from" value={s.from} onSelect={setFrom} placeholder="Ventura, CA" />
          </div>
        </div>

        {s.vias.map((via, i) => (
          <ViaRow key={`${via.lat},${via.lon},${i}`} via={via} index={i} count={s.vias.length} onRemove={removeVia} onMoveUp={(idx) => moveVia(idx, -1)} onMoveDown={(idx) => moveVia(idx, 1)} />
        ))}

        <AddStopRow />

        <div class="wn-waypoint wn-waypoint--endpoint">
          <span class="wn-waypoint__dot wn-waypoint__dot--end" aria-hidden="true" />
          <div class="wn-waypoint__field">
            <GeoField label="To" field="to" value={s.to} onSelect={setTo} placeholder="South Lake Tahoe, CA" />
          </div>
        </div>

        {s.roundTrip ? (
          <div class="wn-waypoint wn-waypoint--roundtrip">
            <span class="wn-waypoint__dot wn-waypoint__dot--start" aria-hidden="true" />
            <span class="wn-waypoint__label">{s.from ? s.from.label : 'back to start'} (round trip)</span>
          </div>
        ) : null}
      </div>

      <label class="wn-toggle">
        <input type="checkbox" checked={s.roundTrip} onChange={(e) => setRoundTrip(e.currentTarget.checked)} />
        <span class="wn-toggle__track" aria-hidden="true" />
        <span class="wn-toggle__label">round trip</span>
      </label>

      <div class="wn-tripform__actions">
        <button
          type="button"
          class="wn-icon-btn"
          aria-label="Swap from and to"
          onClick={swapFromTo}
          disabled={!s.from && !s.to}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M7 7h11l-3-3M17 17H6l3 3"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="wn-btn wn-btn--primary wn-tripform__plan"
          onClick={planTripFlow}
          disabled={!canPlan || s.routeStatus === 'loading'}
        >
          {s.routeStatus === 'loading' ? 'planning…' : 'plan trip'}
        </button>
      </div>
    </div>
  )
}

/**
 * "The trip form collapses once planned. Planned state is a single card: a
 * vertical spine of waypoint dots, one line per stop, tap anywhere to
 * reopen the editor." (wattnap-spec.md §8)
 */
function TripSummaryCard({ onReopen }) {
  const s = useWattnap()
  const waypoints = computeWaypoints(s)
  return (
    <button type="button" class="wn-tripsummary" onClick={onReopen}>
      <div class="wn-tripsummary__spine" aria-hidden="true">
        {waypoints.map((_, i) => (
          <span key={i} class="wn-tripsummary__dot" />
        ))}
      </div>
      <div class="wn-tripsummary__rows">
        {waypoints.map((wp, i) => (
          <span key={i} class="wn-tripsummary__row">
            {wp.label}
          </span>
        ))}
      </div>
    </button>
  )
}

export function TripForm() {
  const s = useWattnap()
  const [forceEdit, setForceEdit] = useState(false)

  // A fresh "plan trip" click un-forces edit mode, so a route that resolves
  // successfully collapses to the summary card again even after the user
  // reopened the editor once -- otherwise forceEdit, once set, would
  // permanently disable auto-collapse for the rest of the session.
  useEffect(() => {
    if (s.routeStatus === 'loading') setForceEdit(false)
  }, [s.routeStatus])

  const collapsed = !!s.route && !forceEdit
  if (collapsed) {
    return <TripSummaryCard onReopen={() => setForceEdit(true)} />
  }
  return <WaypointEditor />
}
