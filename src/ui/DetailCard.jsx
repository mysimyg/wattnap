import { KwBadge } from './KwBadge.jsx'
import { Icon } from './Icon.jsx'
import { kwToneVar } from '../map/pins.js'
import { addStationAsStop, planTripFlow, useWattnap } from '../state.js'

function CloseButton({ onClose }) {
  return (
    <button type="button" class="wn-icon-btn wn-icon-btn--small wn-detailcard__close" onClick={onClose} aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  )
}

function StationDetail({ station, onClose }) {
  const s = useWattnap()
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}`
  const canAddStop = !!s.from && !!s.to
  function handleAddAsStop() {
    addStationAsStop(station)
    onClose()
    planTripFlow()
  }
  return (
    <div class="wn-card wn-detailcard">
      <div class="wn-detailcard__head">
        <div class="wn-detailcard__icon" style={{ '--tone': kwToneVar(station) }}>
          <Icon name="zap" size={18} />
        </div>
        <div class="wn-detailcard__headtext">
          <h3 class="wn-card__title">{station.name}</h3>
          <p class="wn-card__meta">
            {station.network || 'Unknown network'} &middot; <KwBadge station={station} />
            {station.portCount ? ` · ${station.portCount} stalls` : ''}
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      {station.address ? <p class="wn-card__line">{station.address}</p> : null}
      <p class="wn-card__line">
        {station.access || 'access unknown'} &middot; status {station.status || 'unknown'}
      </p>
      {station.kwSource === 'unknown' ? (
        <p class="wn-card__note wn-card__note--warn">
          This station has no reported power figure. Treat it as an unknown, not a guaranteed fast charge.
        </p>
      ) : null}
      {/* wattnap-spec.md §7/§9-2: pins this charger into the plan as a
          forced via and re-runs the planner (see addStationAsStop/
          recomputePlan in state.js) -- the multi-stop waypoint model this
          needed didn't exist before phase 6, which is why this button
          wasn't added until now rather than shipped inert. */}
      <div class="wn-card__actions">
        <a class="wn-btn wn-btn--primary" href={mapsUrl} target="_blank" rel="noopener noreferrer">
          navigate
        </a>
        {canAddStop ? (
          <button type="button" class="wn-btn wn-btn--outline" onClick={handleAddAsStop}>
            add as stop
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SleepDetail({ props, category, onClose }) {
  return (
    <div class="wn-card wn-detailcard">
      <div class="wn-detailcard__head">
        <div class="wn-detailcard__icon" style={{ '--tone': `var(--cat-${props.category})` }}>
          <Icon name={(category && category.icon) || 'tent'} size={18} />
        </div>
        <div class="wn-detailcard__headtext">
          <h3 class="wn-card__title">{props.name}</h3>
          <p class="wn-card__meta">{(category && category.label) || props.category}</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      {props.verified === false ? (
        <p class="wn-card__warn" role="note">
          <strong>Unverified.</strong> We found this location but could not confirm its
          overnight policy from a reliable source. Read the notes and judge for yourself
          before relying on it.
        </p>
      ) : null}
      {props.notes ? <p class="wn-card__line">{props.notes}</p> : null}
      <p class="wn-card__note">
        confirmed {props.confirmed || 'date unknown'}
        {props.source ? ` · via ${props.source}` : ''}
      </p>
      {props.ioverlanderUrl || props.sourceUrl ? (
        <div class="wn-card__actions">
          <a
            class="wn-btn wn-btn--primary"
            href={props.ioverlanderUrl || props.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {props.ioverlanderUrl ? 'iOverlander' : 'source'}
          </a>
        </div>
      ) : null}
    </div>
  )
}

export function DetailCard({ pin, sleepCategories, onClose }) {
  if (!pin) return null
  if (pin.kind === 'station') return <StationDetail station={pin.data} onClose={onClose} />
  const category = sleepCategories.find((c) => c.category === pin.data.category)
  return <SleepDetail props={pin.data} category={category} onClose={onClose} />
}
