import { useState } from 'preact/hooks'
import { useWattnap, getVehicle, saveCurrentTrip } from '../state.js'
import { StateMessage, ApiErrorMessage } from './StateMessage.jsx'
import { StrategyEditor } from './StrategyEditor.jsx'
import { CompareView } from './CompareView.jsx'
import { KwBadge } from './KwBadge.jsx'

function fmtMin(mins) {
  if (mins == null || !isFinite(mins)) return '—'
  const m = Math.round(mins)
  const h = Math.floor(m / 60)
  const rem = m % 60
  return h > 0 ? `${h}h ${String(rem).padStart(2, '0')}m` : `${rem}m`
}

/**
 * wattnap-spec.md §7: ".wn-badge--warn ... becomes an inline reason block:
 * warn icon + one sentence naming the gap distance and the climb." The old
 * copy was a static two-sentence lookup by reason; this uses the actual
 * per-stop overrideDetail numbers the planner already computes (D-016) so
 * the sentence names THIS gap and THIS climb, not a generic one.
 */
function overrideSentence(stop) {
  const d = stop.overrideDetail
  if (!d) return stop.overrideReason
  const target = `${Math.round(stop.departSoc)}%`
  const reason =
    stop.overrideReason === 'elevation'
      ? `a ${d.ascentM}m climb ahead of ${d.nextStopName}`
      : `the ${d.nextGapMiles}mi gap to ${d.nextStopName}`
  return `Charged to ${target} instead of ${d.raisedFromSoc}% -- ${reason} needs more than the target window leaves.`
}

function OverrideNote({ stop }) {
  if (!stop.overrideReason) return null
  return (
    <div class="wn-overridenote">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
      <p class="wn-overridenote__text">{overrideSentence(stop)}</p>
    </div>
  )
}

function ChargeWindowTrack({ arriveSoc, departSoc }) {
  const left = Math.max(0, Math.min(100, arriveSoc))
  const width = Math.max(0, Math.min(100, departSoc) - left)
  return (
    <div
      class="wn-chargetrack"
      role="img"
      aria-label={`Charged from ${Math.round(arriveSoc)}% to ${Math.round(departSoc)}%`}
    >
      <div class="wn-chargetrack__fill" style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  )
}

/**
 * A via boundary in the stop list -- "forced arrival" (wattnap-spec.md §8)
 * made visible instead of only implicit in the next leg's startSoc.
 */
function ViaMilestoneRow({ stop }) {
  return (
    <div class="wn-viamilestone">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
      </svg>
      <span>
        Arrive <b>{stop.viaLabel}</b> at <b class="wn-soc">{Math.round(stop.arriveSoc)}%</b>
      </span>
    </div>
  )
}

function StopRow({ stop, index }) {
  return (
    <div class="wn-stop wn-card">
      <div class="wn-stop__head">
        <span class="wn-stop__index">{index + 1}</span>
        <span class="wn-stop__name">{stop.station?.name || 'Unnamed stop'}</span>
        <span class="wn-stop__kw">{stop.station ? <KwBadge station={stop.station} /> : 'kW unknown'}</span>
      </div>
      <div class="wn-stop__socs">
        <span>
          arrive <b class="wn-soc">{Math.round(stop.arriveSoc)}%</b>
        </span>
        <span>
          depart <b class="wn-soc">{Math.round(stop.departSoc)}%</b>
        </span>
        <span>{fmtMin(stop.chargeMinutes)}</span>
      </div>
      <ChargeWindowTrack arriveSoc={stop.arriveSoc} departSoc={stop.departSoc} />
      <OverrideNote stop={stop} />
    </div>
  )
}

export function PlanPanel() {
  const s = useWattnap()
  const [editingStrategy, setEditingStrategy] = useState(false)
  const [comparing, setComparing] = useState(false)

  {/* routeStatus === 'error' must be checked before the !s.route branch --
      a failed fetch leaves s.route null too, and without this ordering the
      failure silently reads as "haven't tried yet" instead of an error. */}
  if (s.routeStatus === 'error') {
    return <ApiErrorMessage err={s.routeError} />
  }

  if (!s.route) {
    return (
      <StateMessage tone="info" title="No route yet">
        <p>Enter a from and to above, then tap "plan trip" to see chargers and a stop plan.</p>
      </StateMessage>
    )
  }

  if (s.routeStatus === 'loading' || s.stationsStatus === 'loading') {
    return (
      <StateMessage tone="info" title="Planning…">
        <p>Fetching the route and chargers along the corridor.</p>
      </StateMessage>
    )
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

  const vehicle = getVehicle(s.vehicleId)
  const plan = s.plan

  return (
    <div class="wn-planpanel">
      <div class="wn-planpanel__toolbar">
        <button type="button" class="wn-btn wn-btn--ghost wn-btn--small" onClick={() => setEditingStrategy(true)}>
          edit strategy
        </button>
        <button type="button" class="wn-btn wn-btn--ghost wn-btn--small" onClick={saveCurrentTrip}>
          save trip
        </button>
      </div>

      {vehicle.estimated ? (
        <p class="wn-planpanel__estimate-note">
          Estimated charge curve for {vehicle.name}. {vehicle.estimateNote}
        </p>
      ) : null}

      {!plan || s.planStatus === 'loading' ? (
        <StateMessage tone="info" title="Computing plan…" />
      ) : plan._stub ? (
        <StateMessage tone="warn" title="Planner not available">
          <p>{plan.warnings[0]}</p>
        </StateMessage>
      ) : !plan.feasible ? (
        <StateMessage tone="error" title="No feasible plan">
          <p>
            {plan.warnings[plan.warnings.length - 1] ||
              'This trip cannot be completed without dropping below the reserve floor on the current strategy.'}
          </p>
          <p>Try a wider corridor, a lower arrive-SOC target, or a different strategy.</p>
        </StateMessage>
      ) : (
        <>
          <div class="wn-summary">
            <div class="wn-summary__hero">
              <p class="wn-summary__headline">{fmtMin(plan.summary.totalMinutes)}</p>
              <div class="wn-summary__meta">
                <span>{fmtMin(plan.summary.driveMinutes)} drive</span>
                <span>
                  {plan.summary.stopCount} stop{plan.summary.stopCount === 1 ? '' : 's'} ·{' '}
                  {fmtMin(plan.summary.chargeMinutes)} charging
                </span>
              </div>
            </div>
          </div>

          {plan.warnings && plan.warnings.length > 0 ? (
            <div class="wn-warnings">
              {plan.warnings.map((w, i) => (
                <p key={i} class="wn-warnings__item">
                  {w}
                </p>
              ))}
            </div>
          ) : null}

          <div class="wn-stoplist">
            {(() => {
              // Charging stops number sequentially (1, 2, 3...); via
              // milestones sit inline between them without consuming a
              // number -- they're waypoints, not charging stops.
              let chargeIndex = 0
              return plan.stops.map((stop, i) =>
                stop.isViaMilestone ? (
                  <ViaMilestoneRow stop={stop} key={`via-${i}`} />
                ) : (
                  <StopRow stop={stop} index={chargeIndex++} key={stop.station?.id || i} />
                )
              )
            })()}
          </div>

          <button type="button" class="wn-btn wn-btn--primary wn-planpanel__compare" onClick={() => setComparing(true)}>
            compare strategies
          </button>
        </>
      )}

      {editingStrategy ? <StrategyEditor onClose={() => setEditingStrategy(false)} /> : null}
      {comparing ? <CompareView onClose={() => setComparing(false)} /> : null}
    </div>
  )
}
