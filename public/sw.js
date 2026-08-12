/* wattnap service worker: offline shell + saved trips.
 *
 * Deliberate choice: API responses are NEVER cached here. Stale charger data
 * in a car at night is worse than an honest "you are offline" message. The app
 * shell and saved trips work offline; live station and route data does not.
 */
const VERSION = 'v1'
const SHELL = `wattnap-shell-${VERSION}`
const ASSETS = `wattnap-assets-${VERSION}`

const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => {}) // a failed precache must not wedge the install
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  // Cross-origin (the Worker API, basemap tiles): straight to the network.
  if (!sameOrigin) return

  // Navigations: network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('./index.html', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('./index.html').then((r) => r || offlineResponse()))
    )
    return
  }

  // Same-origin assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone()
            caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})

function offlineResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>wattnap offline</title>' +
      '<body style="background:#0d1117;color:#e6edf3;font:16px system-ui;padding:2rem">' +
      '<h1>Offline</h1><p>wattnap needs a connection to fetch routes and chargers. ' +
      'Saved trips are still on this device and will load once you are back online.</p>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
  )
}
