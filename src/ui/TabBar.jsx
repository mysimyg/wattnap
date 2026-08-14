import { useWattnap, setActiveTab } from '../state.js'

// Icons: lucide/route, lucide/zap (matches the charger pin), lucide/moon.
// wattnap-spec.md §7 names Plan/Chargers/Sleep/Map as the four items but
// doesn't specify icons for them -- these are a reasonable, easily-revised
// choice from the same inlined-Lucide set already used for pins, not
// invented shapes.
const TABS = [
  {
    id: 'plan',
    label: 'Plan',
    icon: (
      <>
        <circle cx="6" cy="19" r="3" />
        <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
        <circle cx="18" cy="5" r="3" />
      </>
    ),
  },
  {
    id: 'chargers',
    label: 'Chargers',
    icon: (
      <path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />
    ),
  },
  {
    id: 'sleep',
    label: 'Sleep',
    icon: (
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    ),
  },
]

const MAP_ICON = (
  <>
    <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
    <path d="M15 5.764v15" />
    <path d="M9 3.236v15" />
  </>
)

function TabIcon({ children }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/**
 * Four items, not three: Plan/Chargers/Sleep switch the panel below as
 * before, Map reuses the existing full-screen toggle (the same one
 * .wn-map-expand drives) rather than introducing a second concept of
 * "expanded" -- wattnap-spec.md §7 doesn't distinguish a new behaviour for
 * it, just a new entry point to the one that already exists.
 */
export function TabBar({ mapExpanded = false, onToggleMap }) {
  const s = useWattnap()
  return (
    <nav class="wn-tabbar" role="tablist" aria-label="Trip sections">
      {TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          role="tab"
          aria-selected={s.activeTab === t.id}
          class={`wn-tabbar__tab${s.activeTab === t.id ? ' wn-tabbar__tab--active' : ''}`}
          onClick={() => setActiveTab(t.id)}
        >
          <TabIcon>{t.icon}</TabIcon>
          <span class="wn-tabbar__label">{t.label}</span>
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={mapExpanded}
        class={`wn-tabbar__tab${mapExpanded ? ' wn-tabbar__tab--active' : ''}`}
        onClick={onToggleMap}
      >
        <TabIcon>{MAP_ICON}</TabIcon>
        <span class="wn-tabbar__label">Map</span>
      </button>
    </nav>
  )
}
