function kwLabel(station) {
  if (station.kwSource === 'unknown') return 'kW unknown'
  const suffix = station.kwSource === 'inferred' ? ' (inferred)' : ' (reported)'
  return `${station.maxKw} kW${suffix}`
}

function StationDetail({ station, onClose }) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}`
  return (
    <div class="wn-card wn-detailcard">
      <h3 class="wn-card__title">{station.name}</h3>
      <p class="wn-card__meta">
        {station.network || 'Unknown network'} &middot; {kwLabel(station)}
        {station.portCount ? ` · ${station.portCount} stalls` : ''}
      </p>
      {station.address ? <p class="wn-card__line">{station.address}</p> : null}
      <p class="wn-card__line">
        {station.access || 'access unknown'} &middot; status {station.status || 'unknown'}
      </p>
      {station.kwSource === 'unknown' ? (
        <p class="wn-card__note wn-card__note--warn">
          This station has no reported power figure. Treat it as an unknown, not a guaranteed fast charge.
        </p>
      ) : null}
      <div class="wn-card__actions">
        <a class="wn-btn wn-btn--primary" href={mapsUrl} target="_blank" rel="noopener noreferrer">
          navigate
        </a>
        <button type="button" class="wn-btn wn-btn--ghost" onClick={onClose}>
          close
        </button>
      </div>
    </div>
  )
}

function SleepDetail({ props, category, onClose }) {
  return (
    <div class="wn-card wn-detailcard">
      <h3 class="wn-card__title">{props.name}</h3>
      <p class="wn-card__meta">{(category && category.label) || props.category}</p>
      {props.notes ? <p class="wn-card__line">{props.notes}</p> : null}
      <p class="wn-card__note">
        confirmed {props.confirmed || 'date unknown'}
        {props.source ? ` · via ${props.source}` : ''}
      </p>
      <div class="wn-card__actions">
        {props.ioverlanderUrl ? (
          <a class="wn-btn wn-btn--primary" href={props.ioverlanderUrl} target="_blank" rel="noopener noreferrer">
            iOverlander
          </a>
        ) : null}
        <button type="button" class="wn-btn wn-btn--ghost" onClick={onClose}>
          close
        </button>
      </div>
    </div>
  )
}

export function DetailCard({ pin, sleepCategories, onClose }) {
  if (!pin) return null
  if (pin.kind === 'station') return <StationDetail station={pin.data} onClose={onClose} />
  const category = sleepCategories.find((c) => c.category === pin.data.category)
  return <SleepDetail props={pin.data} category={category} onClose={onClose} />
}
