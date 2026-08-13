import {
  useWattnap,
  toggleSleepCategory,
  visibleSleepFeatures,
  selectSleepPin,
  stepSleepDetourMi,
  activeJurisdictionWarnings,
} from '../state.js'
import { StateMessage } from './StateMessage.jsx'

function JurisdictionNotice({ warning }) {
  const tier = warning.confidenceTier || 'medium'
  return (
    <div class={`wn-card__warn wn-jxnotice wn-jxnotice--${tier}`} role="note">
      <strong>
        {warning.role === 'to' ? 'Destination' : 'Start'} — {warning.name}:
      </strong>{' '}
      {warning.summary}
      <div class="wn-jxnotice__cite">{warning.citation}</div>
      <div class="wn-jxnotice__confidence">
        <span class={`wn-badge wn-badge--confidence-${tier}`}>{tier} confidence</span>{' '}
        {warning.confidence}
      </div>
      {warning.nearestOption ? (
        <div class="wn-jxnotice__nearest">
          Nearest {warning.nearestOption.unverified ? 'known (unverified)' : 'verified'} option in
          this dataset: <strong>{warning.nearestOption.name}</strong>,{' '}
          ~{Math.round(warning.nearestOption.distMi)} mi away.
          {warning.nearestOption.unverified ? (
            <span class="wn-badge wn-badge--warn"> unverified — check before relying on it</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function SleepPanel() {
  const s = useWattnap()

  if (s.sleepStatus === 'loading') {
    return <StateMessage tone="info" title="Loading sleep spots…" />
  }

  if (s.sleepCategories.length === 0) {
    return (
      <StateMessage tone="info" title="No sleep spot data yet">
        <p>public/data/sleep-index.json is missing or empty in this build — the sleep layer will populate once it ships.</p>
      </StateMessage>
    )
  }

  const features = visibleSleepFeatures(s)
  const jxWarnings = activeJurisdictionWarnings(s)

  return (
    <div class="wn-sleeppanel">
      {jxWarnings.map((w) => (
        <JurisdictionNotice key={w.id + w.role} warning={w} />
      ))}

      {s.route ? (
        <div class="wn-filterbar__row">
          <span class="wn-filterbar__label">sleep detour</span>
          <button
            type="button"
            class="wn-icon-btn wn-icon-btn--small"
            onClick={() => stepSleepDetourMi(-1)}
            aria-label="Narrower sleep search"
          >
            −
          </button>
          <span class="wn-filterbar__value">{s.sleepDetourMi} mi</span>
          <button
            type="button"
            class="wn-icon-btn wn-icon-btn--small"
            onClick={() => stepSleepDetourMi(1)}
            aria-label="Wider sleep search"
          >
            +
          </button>
        </div>
      ) : null}

      <div class="wn-chips">
        {s.sleepCategories.map((c) => (
          <button
            type="button"
            key={c.category}
            class={`wn-chip${s.sleepCategoryEnabled[c.category] !== false ? ' wn-chip--on' : ''}`}
            style={s.sleepCategoryEnabled[c.category] !== false ? `border-color:${c.color};color:${c.color}` : ''}
            onClick={() => toggleSleepCategory(c.category)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {features.length === 0 ? (
        <StateMessage tone="info" title="No sleep spots visible">
          <p>
            {(() => {
              const anyCategoryOn = s.sleepCategories.some((c) => s.sleepCategoryEnabled[c.category] !== false)
              if (!anyCategoryOn) return 'No category is enabled — turn one on above.'
              if (s.route) {
                return `None fall within ${s.sleepDetourMi} mi of the route — widen "sleep detour" above, or enable another category.`
              }
              return 'Enable a category above, or plan a trip to see spots along the corridor.'
            })()}
          </p>
        </StateMessage>
      ) : (
        <ul class="wn-sleeplist">
          {features.map((f) => (
            <li key={f.properties.id}>
              <button type="button" class="wn-sleeplist__item" onClick={() => selectSleepPin(f.properties)}>
                <span class="wn-sleeplist__name">{f.properties.name}</span>
                <span class="wn-sleeplist__meta">
                  confirmed {f.properties.confirmed || 'unknown'}
                  {f.properties.verified === false ? (
                    <span class="wn-badge wn-badge--warn"> unverified</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
