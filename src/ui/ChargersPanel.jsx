import { useWattnap, filteredStations, selectStationPin } from '../state.js'
import { StateMessage, ApiErrorMessage } from './StateMessage.jsx'
import { KwBadge } from './KwBadge.jsx'

/**
 * wattnap-spec.md §9 item 5: the kW slider and network chips live in the
 * shared filter bar above the tab, so this tab reads as filterless. Rather
 * than moving that bar's ownership in here (it also gates what the PLAN
 * tab's stop candidates are, so hiding it on other tabs would hide a
 * planner-affecting control, not just a charger-list one), this surfaces a
 * compact read of the current filter state at the top of the list --
 * "surface a compact filter row inside the tab," the spec's other named
 * option.
 */
function FilterSummary({ s }) {
  const networks = Object.keys(s.networkEnabled)
  const enabledCount = networks.filter((n) => s.networkEnabled[n] !== false).length
  return (
    <div class="wn-chargers-filtersummary">
      <span class="wn-chip wn-chip--on">{s.minKw}kW+</span>
      <span class="wn-chip wn-chip--on">{s.corridorMi}mi corridor</span>
      {networks.length ? (
        <span class="wn-chip wn-chip--on">
          {enabledCount}/{networks.length} networks
        </span>
      ) : null}
    </div>
  )
}

export function ChargersPanel() {
  const s = useWattnap()

  {/* Must come before the !s.route branch -- a failed route fetch also
      leaves s.route null, and without this order the failure would read
      as "haven't planned a trip yet" instead of a real error. */}
  if (s.routeStatus === 'error') {
    return <ApiErrorMessage err={s.routeError} />
  }
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
      <>
        <FilterSummary s={s} />
        <StateMessage tone="warn" title="No chargers match the current filters">
          <p>Lower the min kW or re-enable a network in the filter bar above.</p>
        </StateMessage>
      </>
    )
  }

  return (
    <>
      <FilterSummary s={s} />
      <ul class="wn-chargerlist">
        {list.map((st) => (
          <li key={st.id}>
            <button type="button" class="wn-chargerlist__item" onClick={() => selectStationPin(st)}>
              <span class="wn-chargerlist__name">{st.name}</span>
              <span class="wn-chargerlist__meta">
                {st.network || 'unknown network'} · <KwBadge station={st} />
                {st.detour_m ? ` · ${Math.round(st.detour_m / 1609)} mi detour` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
