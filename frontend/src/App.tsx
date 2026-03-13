import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './config/wagmi'
import { ConnectButton } from './components/ConnectButton'
import { VaultCard } from './components/VaultCard'
import './App.css'

const queryClient = new QueryClient()

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className="app">
          {/* Nav */}
          <nav className="nav">
            <div className="nav-left">
              <span className="logo">Louis</span>
              <span className="nav-tag">Yield Agent</span>
            </div>
            <div className="nav-right">
              <a href="https://github.com/Chrisportugal/louis" target="_blank" className="nav-link">
                GitHub
              </a>
              <ConnectButton />
            </div>
          </nav>

          {/* Hero */}
          <main className="main">
            <div className="hero">
              <h1 className="hero-title">
                Earn the best yield<br />on HyperEVM
              </h1>
              <p className="hero-sub">
                AI-powered vault that automatically routes your deposits
                to the highest-yielding lending protocols.
              </p>
            </div>

            <VaultCard />

            <div className="footer-info">
              <div className="info-item">
                <span className="info-icon">&#9889;</span>
                <div>
                  <strong>AI-Optimized</strong>
                  <p>Autonomous rebalancing across HyperLend, HypurrFi, and Felix vaults</p>
                </div>
              </div>
              <div className="info-item">
                <span className="info-icon">&#128274;</span>
                <div>
                  <strong>Non-Custodial</strong>
                  <p>ERC-4626 vault -- withdraw anytime, your keys your crypto</p>
                </div>
              </div>
              <div className="info-item">
                <span className="info-icon">&#128200;</span>
                <div>
                  <strong>Multi-Protocol</strong>
                  <p>Aave V3 forks + MetaMorpho vaults for maximum diversification</p>
                </div>
              </div>
            </div>
          </main>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
