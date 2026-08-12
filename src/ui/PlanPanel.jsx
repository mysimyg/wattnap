import { useState } from 'preact/hooks'
import { useWattnap, getVehicle, saveCurrentTrip } from '../state.js'
import { StateMessage, ApiErrorMessage } from './StateMessage.jsx'
import { StrategyEditor } from './StrategyEditor.jsx'
import { CompareView } from './CompareView.jsx'

const OVERRIDE_COPY = {
  'sparse-corridor': 'Sparse corridor ahead — charged past the target window to safely reach the next stop.',
  elevation: 'Climb ahead needs more charge than the target window — charged extra to clear it safely.',
}

function fmtMin(mins) {
  if (mins == null || !isFinite(mins)) return '—'
  const m = Math.round(mins)
  const h = Math.floor(m / 60)
  const rem = m % 60
  return h > 0 ? `${h}h ${String(rem).padStart(2, '0')}m` : `${rem}m`
}

function StopRow({ stop, index }) {
  return (
    <div class="wn-stop">
      <div class="wn-stop__head">
        <span class="wn-stop__index">{index + 1}</span>
        <span class="wn-stop__name">{stop.station?.name || 'Unnamed stop'}</span>
        <span class="wn-stop__kw">{stop.station?.maxKw ? `${stop.station.maxKw}kW` : 'kW unknown'}</span>
      </div>
      <div class="wn-stop__socs">
        <span>
          arrive <b class="wn-soc">{Math.round(stop.arriveSoc)}%</b>
        </span>
        <span>
          depart <b class="wn-soc">{Math.round(stop.departSoc)}%</b>
        </span>
        <span>{fmtMin(stop.chargeMinutes)}</span>
        {stop.overrideReason ? <span class="wn-badge wn-badge--warn">!</span> : null}
      </div>
      {stop.overrideReason ? (
        <p class="wn-stop__override">{OVERRIDE_COPY[stop.overrideReason] || stop.overrideReason}</p>
      ) : null}
    </div>
  )
}

export function PlanPanel() {
  const s = useWattnap()
  const [editingStrategy, setEditingStrategy] = useState(false)
  const [comparing, setComparing] = useState(false)

  if (!s.route) {
    return (
      <StateMessage tone="info" title="No route yet">
        <p>Enter a from and to above, then tap "plan trip" to see chargers and a stop plan.</p>
      </StateMessage>
    )
  }

  if (s.routeStatus === 'error') {
    return <ApiErrorMessage err={s.routeError} />
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
            <p class="wn-summary__headline">
              {fmtMin(plan.summary.driveMinutes)} drive → {fmtMin(plan.summary.totalMinutes)} w/ stops
            </p>
            <p class="wn-summary__sub">
              {plan.summary.stopCount} stop{plan.summary.stopCount === 1 ? '' : 's'} · {fmtMin(plan.summary.chargeMinutes)}{' '}
              charging
            </p>
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
            {plan.stops.map((stop, i) => (
              <StopRow stop={stop} index={i} key={stop.station?.id || i} />
            ))}
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
