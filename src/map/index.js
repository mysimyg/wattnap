/**
 * MapLibre GL controller. Framework-agnostic (no Preact in here) so the
 * MapView component just owns the container div and forwards state.
 */
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { darkBasemapStyle } from './basemap.js'
import { chargerPinElement, sleepPinElement } from './pins.js'

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}

export function createMapController(container, { onStationClick, onSleepClick } = {}) {
  const map = new maplibregl.Map({
    container,
    style: darkBasemapStyle(),
    center: [-119.5, 36.5],
    zoom: 5,
    attributionControl: { compact: false },
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  // MapLibre measures its container once at construction and then only
  // re-measures on a WINDOW resize event. Our container gets its real height
  // from flex layout that settles after mount (and shifts again when the
  // API-not-configured banner appears or the tab panel changes), and the
  // window itself never resizes on a phone. Result: the map keeps a stale
  // zero size, never requests a tile, and paints nothing at all -- which
  // looks exactly like a broken basemap URL. Observe the element instead.
  //
  // map.resize() ALONE is not enough -- verified live, twice, on the
  // deployed site: the container ends up correctly sized (canvas at the
  // right pixel dimensions, WebGL context healthy) but zero tiles are ever
  // requested, and calling map.resize() again does not unstick it. Only a
  // genuine `window` resize event reliably makes MapLibre re-run the tile
  // request cascade. No other code in this app listens for window resize,
  // so dispatching one here is a safe, if slightly blunt, forcing function
  // -- the alternative (an unexplained black map on first load) is worse.
  function nudgeMap() {
    map.resize()
    window.dispatchEvent(new Event('resize'))
  }
  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = 0
    let lastH = 0
    resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      const w = Math.round(box.width)
      const h = Math.round(box.height)
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      if (w > 0 && h > 0) nudgeMap()
    })
    resizeObserver.observe(container)
  }
  // Belt and braces for the very first paint, in case layout settles within
  // the same frame and the observer's initial callback is a no-op.
  requestAnimationFrame(nudgeMap)

  let ready = false
  const readyPromise = new Promise((resolve) => {
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: emptyFC() })
      map.addSource('corridor', { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'corridor-fill',
        type: 'fill',
        source: 'corridor',
        paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.06 },
      })
      map.addLayer({
        id: 'route-line-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0b0f14', 'line-width': 7, 'line-opacity': 0.65 },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#22d3ee', 'line-width': 4 },
      })
      ready = true
      resolve()
    })
  })

  let stationMarkers = []
  let sleepMarkers = []

  function clearMarkers(list) {
    list.forEach((m) => m.remove())
    list.length = 0
  }

  function setRoute(geometry, bbox) {
    if (!ready) return readyPromise.then(() => setRoute(geometry, bbox))
    const coords = (geometry || []).map(([lon, lat]) => [lon, lat])
    map.getSource('route').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    })
    if (!coords.length) return
    if (bbox && bbox.length === 4) {
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 48, duration: 600 }
      )
    } else {
      const bounds = coords.reduce(
        (acc, c) => acc.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      )
      map.fitBounds(bounds, { padding: 48, duration: 600 })
    }
  }

  function setCorridor(polygonFeature) {
    if (!ready) return readyPromise.then(() => setCorridor(polygonFeature))
    map.getSource('corridor').setData(polygonFeature || emptyFC())
  }

  function setStations(stations, selectedId) {
    if (!ready) return readyPromise.then(() => setStations(stations, selectedId))
    clearMarkers(stationMarkers)
    for (const s of stations || []) {
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue
      const el = chargerPinElement(s, { selected: s.id === selectedId })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onStationClick && onStationClick(s)
      })
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([s.lon, s.lat])
        .addTo(map)
      stationMarkers.push(marker)
    }
  }

  function setSleepFeatures(features, categoryById, selectedId) {
    if (!ready) return readyPromise.then(() => setSleepFeatures(features, categoryById, selectedId))
    clearMarkers(sleepMarkers)
    for (const f of features || []) {
      const coords = f && f.geometry && f.geometry.coordinates
      if (!coords) continue
      const props = f.properties || {}
      const cat = categoryById[props.category]
      const el = sleepPinElement(cat, { selected: props.id === selectedId })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onSleepClick && onSleepClick(props)
      })
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(coords)
        .addTo(map)
      sleepMarkers.push(marker)
    }
  }

  function destroy() {
    clearMarkers(stationMarkers)
    clearMarkers(sleepMarkers)
    if (resizeObserver) resizeObserver.disconnect()
    map.remove()
  }

  return {
    map,
    setRoute,
    setCorridor,
    setStations,
    setSleepFeatures,
    destroy,
    whenReady: () => readyPromise,
  }
}
