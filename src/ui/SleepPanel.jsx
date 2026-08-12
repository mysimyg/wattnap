import { useWattnap, toggleSleepCategory, visibleSleepFeatures, selectSleepPin } from '../state.js'
import { StateMessage } from './StateMessage.jsx'

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

  return (
    <div class="wn-sleeppanel">
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
          <p>{s.route ? 'None fall within the current view — pan the map or enable a category above.' : 'Enable a category above, or plan a trip to see spots along the corridor.'}</p>
        </StateMessage>
      ) : (
        <ul class="wn-sleeplist">
          {features.map((f) => (
            <li key={f.properties.id}>
              <button type="button" class="wn-sleeplist__item" onClick={() => selectSleepPin(f.properties)}>
                <span class="wn-sleeplist__name">{f.properties.name}</span>
                <span class="wn-sleeplist__meta">
                  confirmed {f.properties.confirmed || 'unknown'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
