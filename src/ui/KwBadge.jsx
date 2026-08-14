import { kwConfidenceClass, kwToneVar } from '../map/pins.js'

/**
 * A station's kW figure, styled per the confidence ladder (wattnap-spec.md
 * §5). Measured stays plain text -- the ladder marks the exceptions
 * (inferred, unknown), not the common case, or every reported station in a
 * long list would carry a swatch.
 */
export function KwBadge({ station }) {
  const cls = kwConfidenceClass(station.kwSource)
  const label = station.kwSource === 'unknown' ? 'kW unknown' : `${station.maxKw} kW`
  const style = cls === 'is-measured' ? undefined : { '--tone': kwToneVar(station) }
  return (
    <span class={cls} style={style}>
      <span class="kw">{label}</span>
    </span>
  )
}
