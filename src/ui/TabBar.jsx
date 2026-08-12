import { useWattnap, setActiveTab } from '../state.js'

const TABS = [
  { id: 'plan', label: 'plan' },
  { id: 'chargers', label: 'chargers' },
  { id: 'sleep', label: 'sleep' },
]

export function TabBar() {
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
          {t.label}
        </button>
      ))}
    </nav>
  )
}
