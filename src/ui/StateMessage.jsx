import { useEffect, useState } from 'preact/hooks'

/**
 * Shared empty/error/loading messaging. Every state gets real copy that
 * tells the driver what to do next — no bare "error" strings.
 */
export function StateMessage({ tone = 'info', title, children, action }) {
  return (
    <div class={`wn-state wn-state--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <p class="wn-state__title">{title}</p> : null}
      {children ? <div class="wn-state__body">{children}</div> : null}
      {action ? (
        <button type="button" class="wn-btn wn-btn--ghost" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

/** Turns an ApiError into driver-facing copy, one branch per distinct code. */
export function describeApiError(err) {
  const code = err && err.code
  switch (code) {
    case 'NOT_CONFIGURED':
      return {
        title: 'API not configured',
        message:
          'This build has no Cloudflare Worker URL set (VITE_API_BASE is empty). Routing, chargers, and geocoding all need it — set the env var and rebuild.',
      }
    case 'RATE_LIMITED':
      return {
        title: 'Rate limited',
        message: 'The shared API key hit its hourly limit. It will recover shortly.',
        retryAfter: err.retryAfter,
      }
    case 'UPSTREAM_ERROR':
      return {
        title: 'Upstream service unavailable',
        message: 'The routing or charger data provider is having trouble. Try again in a minute.',
      }
    case 'NOT_ALLOWED':
      return {
        title: 'Request blocked',
        message: 'This origin is not on the API allowlist. If you are running a fork, point VITE_API_BASE at your own Worker.',
      }
    case 'BAD_REQUEST':
      return {
        title: 'Something about that request was invalid',
        message: err.message || 'Double-check the trip endpoints and try again.',
      }
    case 'TIMEOUT':
      return { title: 'Request timed out', message: 'Check your connection and try again.' }
    case 'OFFLINE':
      return { title: 'You are offline', message: 'Reconnect and try again — wattnap needs the network for routing and charger data.' }
    case 'ABORTED':
      return null
    default:
      return {
        title: 'Something went wrong',
        message: (err && err.message) || 'Unexpected error. Try again.',
      }
  }
}

export function RetryCountdown({ seconds, onDone }) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    setLeft(seconds)
    if (!seconds) return
    const id = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          clearInterval(id)
          onDone && onDone()
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [seconds])
  if (!left) return null
  return <p class="wn-state__countdown">Retry available in {left}s</p>
}

export function ApiErrorMessage({ err, action }) {
  const desc = describeApiError(err)
  if (!desc) return null
  return (
    <StateMessage tone="error" title={desc.title} action={action}>
      <p>{desc.message}</p>
      {desc.retryAfter ? <RetryCountdown seconds={desc.retryAfter} /> : null}
    </StateMessage>
  )
}
