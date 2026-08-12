/**
 * CARTO dark-matter raster basemap. Free, no key, attribution required for
 * both CARTO and OpenStreetMap (CARTO's basemaps are built from OSM data).
 */

export const ATTRIBUTION_HTML =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>'

export function darkBasemapStyle() {
  return {
    version: 8,
    sources: {
      'carto-dark': {
        type: 'raster',
        // NB: no `{r}` placeholder. That is a Leaflet convention; MapLibre
        // passes it through literally and every tile 404s, leaving a black
        // map that looks like a styling problem. `@2x` gives retina tiles,
        // which is what phones want.
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        ],
        tileSize: 256,
        attribution: ATTRIBUTION_HTML,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b0f14' } },
      { id: 'carto-dark-layer', type: 'raster', source: 'carto-dark', minzoom: 0, maxzoom: 20 },
    ],
  }
}
