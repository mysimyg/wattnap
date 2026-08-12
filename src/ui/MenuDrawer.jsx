import { useWattnap, loadTripIntoState, deleteSavedTrip } from '../state.js'

export function MenuDrawer({ onClose }) {
  const s = useWattnap()

  return (
    <div class="wn-modal-backdrop" onClick={onClose}>
      <div class="wn-drawer" onClick={(e) => e.stopPropagation()}>
        <div class="wn-modal__head">
          <h2>Saved trips</h2>
          <button type="button" class="wn-icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {s.savedTrips.length === 0 ? (
          <p class="wn-modal__hint">No saved trips yet. Plan a trip, then tap "save trip" in the plan tab.</p>
        ) : (
          <ul class="wn-triplist">
            {s.savedTrips.map((trip) => (
              <li key={trip.id} class="wn-triplist__item">
                <button
                  type="button"
                  class="wn-triplist__load"
                  onClick={() => {
                    loadTripIntoState(trip)
                    onClose()
                  }}
                >
                  <span class="wn-triplist__route">
                    {trip.from?.label} → {trip.to?.label}
                  </span>
                  <span class="wn-triplist__date">{new Date(trip.savedAt).toLocaleDateString()}</span>
                </button>
                <button
                  type="button"
                  class="wn-icon-btn wn-icon-btn--small"
                  aria-label="Delete saved trip"
                  onClick={() => deleteSavedTrip(trip.id)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
