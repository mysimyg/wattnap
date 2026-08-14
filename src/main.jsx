import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import './styles.css'
import { registerServiceWorker } from './pwa.js'
import * as api from './api/client.js'
import { useWattnap, restoreLastTrip, loadSleepIndex } from './state.js'
import { Header } from './ui/Header.jsx'
import { TripForm } from './ui/TripForm.jsx'
import { MapView } from './ui/MapView.jsx'
import { FilterBar } from './ui/FilterBar.jsx'
import { TabBar } from './ui/TabBar.jsx'
import { PlanPanel } from './ui/PlanPanel.jsx'
import { ChargersPanel } from './ui/ChargersPanel.jsx'
import { SleepPanel } from './ui/SleepPanel.jsx'
import { MenuDrawer } from './ui/MenuDrawer.jsx'
import { StateMessage } from './ui/StateMessage.jsx'

function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function ApiNotConfigured() {
  return (
    <main class="wn-notconfigured">
      <StateMessage tone="warn" title="API not configured">
        <p>
          wattnap needs a Cloudflare Worker to talk to the routing and charger data providers — a static site
          cannot hold the API keys those need.
        </p>
        <p>
          Set <code>VITE_API_BASE</code> to your deployed Worker's URL (e.g.
          <code> https://wattnap-api.&lt;account&gt;.workers.dev</code>) and rebuild. In local dev, add it to
          <code> .env.local</code>.
        </p>
      </StateMessage>
    </main>
  )
}

function App() {
  const s = useWattnap()
  const online = useOnlineStatus()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mapExpanded, setMapExpanded] = useState(false)

  useEffect(() => {
    loadSleepIndex()
    restoreLastTrip()
  }, [])

  return (
    <div class={`wn-app${mapExpanded ? ' wn-app--mapfull' : ''}`}>
      <Header onMenuToggle={() => setMenuOpen(true)} />
      {/* A missing API base blocks routing and chargers, but sleep spots are
          static files in this repo and the map still works. Show a banner, not
          a wall -- hiding the whole app hides things that do work. */}
      {!api.isConfigured ? <ApiNotConfigured /> : null}
      {!online ? (
        <div class="wn-offline-banner" role="status">
          Offline — showing the last loaded trip. Routing and charger lookups need a connection.
        </div>
      ) : null}
      {/* .wn-body / .wn-side are `display: contents` on phones, so these all
          stay direct flex children of .wn-app and keep the mobile stacking
          order. At desktop widths they become real boxes: controls in a left
          column, map filling the rest full-height. One DOM, two layouts, no
          duplicated markup. */}
      <div class="wn-body">
        <div class="wn-side">
          <TripForm />
          <FilterBar />
          <TabBar mapExpanded={mapExpanded} onToggleMap={() => setMapExpanded((v) => !v)} />
          <section class="wn-tabpanel">
            {s.activeTab === 'plan' ? <PlanPanel /> : null}
            {s.activeTab === 'chargers' ? <ChargersPanel /> : null}
            {s.activeTab === 'sleep' ? <SleepPanel /> : null}
          </section>
        </div>
        <MapView expanded={mapExpanded} onToggleExpand={() => setMapExpanded((v) => !v)} />
      </div>
      {menuOpen ? <MenuDrawer onClose={() => setMenuOpen(false)} /> : null}
    </div>
  )
}

registerServiceWorker()
render(<App />, document.getElementById('app'))
