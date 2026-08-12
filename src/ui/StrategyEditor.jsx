import {
  useWattnap,
  setStrategyField,
  setStartSoc,
  setVehicleId,
  applyStrategyPreset,
  saveStrategyAsDefault,
  getStrategyPresets,
  getVehicles,
} from '../state.js'

function NumberField({ label, value, min, max, step = 1, unit, onChange }) {
  return (
    <label class="wn-field">
      <span class="wn-field__label">
        {label} <span class="wn-field__value">{value}{unit}</span>
      </span>
      <input
        class="wn-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  )
}

export function StrategyEditor({ onClose }) {
  const s = useWattnap()
  const strat = s.strategy
  const presets = [...getStrategyPresets(), ...s.savedStrategies.filter((sv) => !getStrategyPresets().some((p) => p.id === sv.id))]

  return (
    <div class="wn-modal-backdrop" onClick={onClose}>
      <div class="wn-modal" onClick={(e) => e.stopPropagation()}>
        <div class="wn-modal__head">
          <h2>Strategy</h2>
          <button type="button" class="wn-icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <label class="wn-field">
          <span class="wn-field__label">preset</span>
          <select class="wn-select" onChange={(e) => applyStrategyPreset(e.currentTarget.value)}>
            <option value="">custom</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id} selected={p.id === strat.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label class="wn-field">
          <span class="wn-field__label">vehicle</span>
          <select class="wn-select" value={s.vehicleId} onChange={(e) => setVehicleId(e.currentTarget.value)}>
            {getVehicles().map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.estimated ? ' (est.)' : ''}
              </option>
            ))}
          </select>
        </label>

        <NumberField label="start SOC" unit="%" value={s.startSoc} min={5} max={100} onChange={setStartSoc} />
        <NumberField
          label="arrive SOC target"
          unit="%"
          value={strat.arriveSocTarget}
          min={5}
          max={25}
          onChange={(v) => setStrategyField('arriveSocTarget', v)}
        />
        <NumberField
          label="depart SOC target"
          unit="%"
          value={strat.departSocTarget}
          min={20}
          max={100}
          onChange={(v) => setStrategyField('departSocTarget', v)}
        />
        <NumberField
          label="taper cutoff"
          unit=" kW"
          value={strat.taperCutoffKw}
          min={0}
          max={200}
          step={5}
          onChange={(v) => setStrategyField('taperCutoffKw', v)}
        />
        <NumberField
          label="reserve floor"
          unit="%"
          value={strat.reserveFloor}
          min={3}
          max={20}
          onChange={(v) => setStrategyField('reserveFloor', v)}
        />
        <NumberField
          label="overhead per stop"
          unit=" min"
          value={strat.overheadMinPerStop}
          min={0}
          max={20}
          onChange={(v) => setStrategyField('overheadMinPerStop', v)}
        />

        <div class="wn-modal__actions">
          <button type="button" class="wn-btn wn-btn--primary" onClick={() => saveStrategyAsDefault(strat)}>
            save as default
          </button>
          <button type="button" class="wn-btn wn-btn--ghost" onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  )
}
