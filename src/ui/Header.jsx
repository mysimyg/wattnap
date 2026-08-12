import { useEffect, useState } from 'preact/hooks'

export function Header({ onMenuToggle }) {
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    function onBeforeInstall(e) {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  return (
    <header class="wn-header">
      <button
        type="button"
        class="wn-icon-btn"
        aria-label="Menu"
        onClick={onMenuToggle}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
      <span class="wn-header__title">wattnap</span>
      <button
        type="button"
        class="wn-btn wn-btn--small"
        onClick={handleInstall}
        disabled={!installPrompt}
        title={installPrompt ? 'Install wattnap' : 'Install not available yet'}
      >
        install
      </button>
    </header>
  )
}
