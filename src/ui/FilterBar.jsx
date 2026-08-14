import { useWattnap, setMinKw, toggleNetwork, setCorridorMi, filteredStations } from '../state.js'

const CORRIDOR_STEPS = [2, 5, 10, 15, 25, 50]

export function FilterBar() {
  const s = useWattnap()
  if (!s.route) return null

  const networks = Object.keys(s.networkEnabled).sort()
  const shown = filteredStations(s)
  const stepIndex = Math.max(0, CORRIDOR_STEPS.indexOf(s.corridorMi))

  function stepCorridor(dir) {
    const next = CORRIDOR_STEPS[Math.min(CORRIDOR_STEPS.length - 1, Math.max(0, stepIndex + dir))]
    if (next !== s.corridorMi) setCorridorMi(next)
  }

  return (
    <div class="wn-filterbar">
      <div class="wn-filterbar__row">
        <span class="wn-filterbar__label">corridor</span>
        <div class="wn-stepper">
          <button type="button" class="wn-stepper__btn" onClick={() => stepCorridor(-1)} aria-label="Narrower corridor">
            −
          </button>
          <span class="wn-stepper__value">{s.corridorMi} mi</span>
          <button type="button" class="wn-stepper__btn" onClick={() => stepCorridor(1)} aria-label="Wider corridor">
            +
          </button>
        </div>
      </div>

      <div class="wn-filterbar__row">
        <label class="wn-filterbar__label" for="wn-kw-slider">
          min kW
        </label>
        <input
          id="wn-kw-slider"
          class="wn-slider"
          type="range"
          min="0"
          max="350"
          step="10"
          value={s.minKw}
          onInput={(e) => setMinKw(Number(e.currentTarget.value))}
        />
        <span class="wn-filterbar__value wn-filterbar__value--kw">{s.minKw}</span>
      </div>

      {networks.length > 0 ? (
        <div class="wn-filterbar__row wn-filterbar__row--chips">
          <span class="wn-filterbar__label">net</span>
          <div class="wn-chips">
            {networks.map((n) => (
              <button
                type="button"
                key={n}
                class={`wn-chip${s.networkEnabled[n] !== false ? ' wn-chip--on' : ''}`}
                onClick={() => toggleNetwork(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {s.stationsMeta && s.stationsMeta.unknownKw > 0 ? (
        <p class="wn-filterbar__note">
          {s.stationsMeta.unknownKw} station{s.stationsMeta.unknownKw === 1 ? '' : 's'} in this corridor
          {s.stationsMeta.unknownKw === 1 ? ' has' : ' have'} no reported power.
        </p>
      ) : null}

      {s.stationsStatus === 'success' && shown.length === 0 ? (
        <p class="wn-filterbar__note wn-filterbar__note--warn">
          No stations match the current filters — try lowering min kW or re-enabling a network.
        </p>
      ) : null}
    </div>
  )
}
