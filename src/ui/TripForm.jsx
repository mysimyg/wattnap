import { useEffect, useRef, useState } from 'preact/hooks'
import * as api from '../api/client.js'
import { setFrom, setTo, swapFromTo, planTripFlow, useWattnap } from '../state.js'
import { describeApiError } from './StateMessage.jsx'

function GeoField({ label, field, value, onSelect, placeholder }) {
  const [query, setQuery] = useState(value ? value.label : '')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    setQuery(value ? value.label : '')
  }, [value])

  function handleInput(e) {
    const q = e.currentTarget.value
    setQuery(q)
    setError(null)
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
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p class="wn-geofield__error">{describeApiError(error)?.message}</p> : null}
    </div>
  )
}

export function TripForm() {
  const s = useWattnap()
  const canPlan = !!s.from && !!s.to

  return (
    <div class="wn-tripform">
      <GeoField label="From" field="from" value={s.from} onSelect={setFrom} placeholder="Ventura, CA" />
      <GeoField label="To" field="to" value={s.to} onSelect={setTo} placeholder="South Lake Tahoe, CA" />
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
