/**
 * Service worker registration. Imported by main.jsx.
 * Dev is deliberately excluded -- a cached shell during development is a
 * debugging trap.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return
  window.addEventListener('load', () => {
    const url = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).catch((err) => {
      console.warn('service worker registration failed', err)
    })
  })
}

/** True when the app is running as an installed PWA. */
export function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}
