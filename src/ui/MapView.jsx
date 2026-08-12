import { useEffect, useRef } from 'preact/hooks'
import { createMapController } from '../map/index.js'
import {
  useWattnap,
  filteredStations,
  visibleSleepFeatures,
  selectStationPin,
  selectSleepPin,
  closeDetailCard,
} from '../state.js'
import { DetailCard } from './DetailCard.jsx'

export function MapView() {
  const s = useWattnap()
  const containerRef = useRef(null)
  const controllerRef = useRef(null)

  useEffect(() => {
    const controller = createMapController(containerRef.current, {
      onStationClick: selectStationPin,
      onSleepClick: selectSleepPin,
    })
    controllerRef.current = controller
    return () => controller.destroy()
  }, [])

  useEffect(() => {
    if (!controllerRef.current || !s.route) return
    controllerRef.current.setRoute(s.route.geometry, s.route.bbox)
  }, [s.route])

  useEffect(() => {
    if (!controllerRef.current) return
    controllerRef.current.setCorridor(s.corridorPolygon)
  }, [s.corridorPolygon])

  useEffect(() => {
    if (!controllerRef.current) return
    const selectedId = s.selectedPin && s.selectedPin.kind === 'station' ? s.selectedPin.data.id : null
    controllerRef.current.setStations(filteredStations(s), selectedId)
  }, [s.stations, s.minKw, s.networkEnabled, s.selectedPin])

  useEffect(() => {
    if (!controllerRef.current) return
    const categoryById = {}
    s.sleepCategories.forEach((c) => {
      categoryById[c.category] = c
    })
    const selectedId = s.selectedPin && s.selectedPin.kind === 'sleep' ? s.selectedPin.data.id : null
    controllerRef.current.setSleepFeatures(visibleSleepFeatures(s), categoryById, selectedId)
  }, [s.sleepFeatures, s.sleepCategoryEnabled, s.sleepCategories, s.selectedPin])

  return (
    <div class="wn-map-wrap">
      <div class="wn-map" ref={containerRef} />
      {s.selectedPin ? (
        <DetailCard pin={s.selectedPin} sleepCategories={s.sleepCategories} onClose={closeDetailCard} />
      ) : null}
    </div>
  )
}
