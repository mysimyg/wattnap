import {
  useWattnap,
  toggleSleepCategory,
  visibleSleepFeatures,
  selectSleepPin,
  stepSleepDetourMi,
  activeJurisdictionWarnings,
} from '../state.js'
import { StateMessage } from './StateMessage.jsx'
import { sleepConfidenceClass } from '../map/pins.js'
import { Icon } from './Icon.jsx'

// wattnap-spec.md §5: "a 4-segment meter, filled segments = confidence, the
// empty one dashed." Exact fill counts per tier aren't given in the spec,
// so this reserves one segment as permanently dashed even at "high" --
// nothing in this dataset is claimed as absolute certainty, matching how
// kwSource/verified never let an inferred or unverified figure read as a
// confirmed one anywhere else in the app.
const CONFIDENCE_METER_FILLED = { high: 3, medium: 2, low: 1 }

function ConfidenceMeter({ tier }) {
  const filled = CONFIDENCE_METER_FILLED[tier] ?? 1
  return (
    <div class="wn-confidence-meter" role="img" aria-label={`${tier} confidence`}>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} class={i < filled ? 'is-measured' : 'is-unknown'} style={{ '--tone': 'var(--warn)' }} />
      ))}
    </div>
  )
}

/**
 * wattnap-spec.md §7: "Gets a header band and a titled body so it can
 * never be mistaken for a listing: ADVISORY · DESTINATION strip, city name
 * at title size, summary, hairline, ordinance citation, 4-segment
 * confidence meter, then the nearest-legal-spot row as a filled button."
 * Also §1's own check: "The advisory card cannot be mistaken for a
 * sleep-spot listing at a glance. If it can, its header band is wrong" --
 * this is the one thing on this screen worth over-building rather than
 * under-building.
 */
function JurisdictionNotice({ warning }) {
  const tier = warning.confidenceTier || 'medium'
  return (
    <div class={`wn-jxnotice wn-jxnotice--${tier}`} role="note">
      <div class="wn-jxnotice__band">
        <span class="wn-jxnotice__kicker">Advisory · {warning.role === 'to' ? 'Destination' : 'Start'}</span>
      </div>
      <div class="wn-jxnotice__body">
        <h3 class="wn-jxnotice__title">{warning.name}</h3>
        <p class="wn-jxnotice__summary">{warning.summary}</p>
        <div class="wn-jxnotice__hairline" />
        <p class="wn-jxnotice__cite">{warning.citation}</p>
        <div class="wn-jxnotice__confidence">
          <span class={`wn-badge wn-badge--confidence-${tier}`}>{tier} confidence</span>
          <ConfidenceMeter tier={tier} />
          <span>{warning.confidence}</span>
        </div>
        {warning.nearestOption ? (
          <button
            type="button"
            class="wn-btn wn-btn--primary wn-jxnotice__nearest"
            onClick={() => warning.nearestOption.properties && selectSleepPin(warning.nearestOption.properties)}
          >
            <span>
              Nearest {warning.nearestOption.unverified ? 'known (unverified)' : 'verified'} option:{' '}
              {warning.nearestOption.name}, ~{Math.round(warning.nearestOption.distMi)} mi away
            </span>
            {warning.nearestOption.unverified ? <span class="wn-badge wn-badge--warn">unverified</span> : null}
          </button>
        ) : null}
      </div>
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
          <div class="wn-stepper">
            <button type="button" class="wn-stepper__btn" onClick={() => stepSleepDetourMi(-1)} aria-label="Narrower sleep search">
              −
            </button>
            <span class="wn-stepper__value">{s.sleepDetourMi} mi</span>
            <button type="button" class="wn-stepper__btn" onClick={() => stepSleepDetourMi(1)} aria-label="Wider sleep search">
              +
            </button>
          </div>
        </div>
      ) : null}

      <div class="wn-chips">
        {s.sleepCategories.map((c) => {
          const on = s.sleepCategoryEnabled[c.category] !== false
          return (
            <button
              type="button"
              key={c.category}
              class={`wn-chip${on ? ' wn-chip--on' : ''}`}
              style={on ? { '--tone': `var(--cat-${c.category})` } : undefined}
              onClick={() => toggleSleepCategory(c.category)}
            >
              <Icon name={c.icon} />
              {c.label}
            </button>
          )
        })}
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
                    <span class={sleepConfidenceClass(false)} style={{ '--tone': 'var(--warn)' }}>
                      {' '}
                      <span class="kw">unverified</span>
                    </span>
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
