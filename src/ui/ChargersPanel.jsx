import { useWattnap, filteredStations, selectStationPin } from '../state.js'
import { StateMessage, ApiErrorMessage } from './StateMessage.jsx'

function kwLabel(station) {
  if (station.kwSource === 'unknown') return 'kW unknown'
  return `${station.maxKw} kW`
}

export function ChargersPanel() {
  const s = useWattnap()

  if (!s.route) {
    return (
      <StateMessage tone="info" title="No route yet">
        <p>Plan a trip above to see chargers along the corridor.</p>
      </StateMessage>
    )
  }
  if (s.stationsStatus === 'loading') {
    return <StateMessage tone="info" title="Fetching chargers…" />
  }
  if (s.stationsStatus === 'error') {
    return <ApiErrorMessage err={s.stationsError} />
  }
  if (s.stationsStatus === 'success' && s.stations.length === 0) {
    return (
      <StateMessage tone="warn" title="No chargers found in this corridor">
        <p>Try widening the corridor distance in the filter bar above.</p>
      </StateMessage>
    )
  }

  const list = filteredStations(s)
    .slice()
    .sort((a, b) => (a.distanceAlongRoute_m ?? 0) - (b.distanceAlongRoute_m ?? 0))

  if (list.length === 0) {
    return (
      <StateMessage tone="warn" title="No chargers match the current filters">
        <p>Lower the min kW or re-enable a network in the filter bar above.</p>
      </StateMessage>
    )
  }

  return (
    <ul class="wn-chargerlist">
      {list.map((st) => (
        <li key={st.id}>
          <button type="button" class="wn-chargerlist__item" onClick={() => selectStationPin(st)}>
            <span class="wn-chargerlist__name">{st.name}</span>
            <span class="wn-chargerlist__meta">
              {st.network || 'unknown network'} · {kwLabel(st)}
              {st.detour_m ? ` · ${Math.round(st.detour_m / 1609)} mi detour` : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
