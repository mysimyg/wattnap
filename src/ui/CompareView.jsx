import { useEffect } from 'preact/hooks'
import { useWattnap, setCompareIds, runCompare, getStrategyPresets, saveStrategyAsDefault } from '../state.js'

function fmtMin(mins) {
  if (mins == null || !isFinite(mins)) return '—'
  const m = Math.round(mins)
  const h = Math.floor(m / 60)
  const rem = m % 60
  return h > 0 ? `${h}h${String(rem).padStart(2, '0')}m` : `${rem}m`
}

export function CompareView({ onClose }) {
  const s = useWattnap()
  const options = [...getStrategyPresets(), ...s.savedStrategies.filter((sv) => !getStrategyPresets().some((p) => p.id === sv.id))]

  useEffect(() => {
    if (s.compareIds.length === 0) {
      const defaults = options.slice(0, 2).map((o) => o.id)
      setCompareIds(defaults)
    }
  }, [])

  function toggle(id) {
    const has = s.compareIds.includes(id)
    if (has) setCompareIds(s.compareIds.filter((x) => x !== id))
    else if (s.compareIds.length < 3) setCompareIds([...s.compareIds, id])
  }

  const results = s.compareResults || []
  const baseline = results[0]

  return (
    <div class="wn-modal-backdrop" onClick={onClose}>
      <div class="wn-modal" onClick={(e) => e.stopPropagation()}>
        <div class="wn-modal__head">
          <h2>Compare strategies</h2>
          <button type="button" class="wn-icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div class="wn-chips">
          {options.map((o) => (
            <button
              type="button"
              key={o.id}
              class={`wn-chip${s.compareIds.includes(o.id) ? ' wn-chip--on' : ''}`}
              onClick={() => toggle(o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>

        <button
          type="button"
          class="wn-btn wn-btn--primary"
          disabled={s.compareIds.length === 0 || s.compareStatus === 'loading'}
          onClick={runCompare}
        >
          {s.compareStatus === 'loading' ? 'running…' : 'run comparison'}
        </button>

        {results.length > 0 ? (
          <div class="wn-comparetable">
            <table>
              <thead>
                <tr>
                  <th></th>
                  {results.map((r) => (
                    <th key={r.strategy.id}>{r.strategy.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>stops</td>
                  {results.map((r) => (
                    <td key={r.strategy.id}>{r.plan.feasible ? r.plan.summary.stopCount : '—'}</td>
                  ))}
                </tr>
                <tr>
                  <td>charging</td>
                  {results.map((r) => (
                    <td key={r.strategy.id}>{r.plan.feasible ? fmtMin(r.plan.summary.chargeMinutes) : '—'}</td>
                  ))}
                </tr>
                <tr>
                  <td>total</td>
                  {results.map((r) => (
                    <td key={r.strategy.id}>{r.plan.feasible ? fmtMin(r.plan.summary.totalMinutes) : 'infeasible'}</td>
                  ))}
                </tr>
                <tr>
                  <td>delta</td>
                  {results.map((r, i) => {
                    if (!r.plan.feasible || !baseline?.plan?.feasible) return <td key={r.strategy.id}>—</td>
                    if (i === 0) return <td key={r.strategy.id}>--</td>
                    const delta = r.plan.summary.totalMinutes - baseline.plan.summary.totalMinutes
                    const sign = delta >= 0 ? '+' : ''
                    return (
                      <td key={r.strategy.id}>
                        {sign}
                        {fmtMin(Math.abs(delta))}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
            <div class="wn-modal__actions">
              {results.map((r) => (
                <button
                  type="button"
                  key={r.strategy.id}
                  class="wn-btn wn-btn--ghost wn-btn--small"
                  onClick={() => saveStrategyAsDefault(r.strategy)}
                >
                  save {r.strategy.name} as default
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p class="wn-modal__hint">Pick two or three strategies, then run the comparison.</p>
        )}
      </div>
    </div>
  )
}
