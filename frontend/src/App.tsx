import { useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './config/wagmi'
import { ConnectButton } from './components/ConnectButton'
import { VaultCard } from './components/VaultCard'
import { PointsCard } from './components/PointsCard'
import { BridgeCard } from './components/BridgeCard'
import { DisclaimerModal } from './components/DisclaimerModal'
import './App.css'

const queryClient = new QueryClient()

const GitHubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
  </svg>
)

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
)

type Page = 'vault' | 'bridge' | 'points'

function App() {
  const [page, setPage] = useState<Page>('vault')

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className="app">
          <nav className="nav">
            <div className="nav-left">
              <span className="logo" onClick={() => setPage('vault')} style={{ cursor: 'pointer' }}>
                Louis
              </span>
              <div className="nav-tabs">
                <button
                  className={`nav-tab ${page === 'vault' ? 'active' : ''}`}
                  onClick={() => setPage('vault')}
                >
                  Vault
                </button>
                <button
                  className={`nav-tab ${page === 'bridge' ? 'active' : ''}`}
                  onClick={() => setPage('bridge')}
                >
                  Bridge
                </button>
                <button
                  className={`nav-tab ${page === 'points' ? 'active' : ''}`}
                  onClick={() => setPage('points')}
                >
                  Points
                </button>
                <a href="/docs.html" className="nav-tab">
                  Docs
                </a>
              </div>
            </div>
            <div className="nav-right">
              <a href="https://github.com/Chrisportugal/louis" target="_blank" rel="noopener noreferrer" className="nav-icon-sm" title="GitHub">
                <GitHubIcon />
              </a>
              <a href="https://x.com/louisfixyz" target="_blank" rel="noopener noreferrer" className="nav-icon-sm" title="X">
                <XIcon />
              </a>
              <ConnectButton />
            </div>
          </nav>

          {page === 'vault' && (
            <main className="main">
              <div className="hero">
                <h1 className="hero-title">AI Yield Agent on HyperEVM</h1>
                <p className="hero-sub">
                  Deposit stablecoins. The vault routes to the best
                  yield opportunities on HyperEVM.
                </p>
              </div>
              <VaultCard />
            </main>
          )}

          {page === 'bridge' && (
            <main className="main">
              <div className="hero">
                <h1 className="hero-title">Bridge to HyperEVM</h1>
                <p className="hero-sub">
                  Bridge assets from any chain to HyperEVM, then deposit into the vault.
                </p>
              </div>
              <BridgeCard />
            </main>
          )}

          {page === 'points' && (
            <main className="main-wide">
              <PointsCard />
            </main>
          )}

          <DisclaimerModal />
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
