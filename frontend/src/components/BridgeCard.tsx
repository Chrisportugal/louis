import { useState } from 'react'

type BridgeProvider = 'across' | 'debridge'

const ACROSS_URL =
  'https://app.across.to/bridge?destinationChainId=999&outputToken=0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5'

const DEBRIDGE_URL =
  'https://app.debridge.finance/?r=31377&inputChain=7565164&outputChain=999&inputCurrency=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputCurrency=0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5&dlnSwitch=true'

export function BridgeCard() {
  const [provider, setProvider] = useState<BridgeProvider>('across')

  return (
    <div className="bridge-card">
      <div className="bridge-header">
        <h2 className="bridge-title">Bridge to HyperEVM</h2>
        <span className="bridge-subtitle">Deposit from any chain</span>
      </div>

      {/* Provider Toggle */}
      <div className="mode-toggle">
        <button
          className={provider === 'across' ? 'active' : ''}
          onClick={() => setProvider('across')}
        >
          Across
        </button>
        <button
          className={provider === 'debridge' ? 'active' : ''}
          onClick={() => setProvider('debridge')}
        >
          deBridge
        </button>
      </div>

      {/* Provider description */}
      <div className="bridge-desc">
        {provider === 'across'
          ? 'Bridge from Ethereum, Arbitrum, Base, Optimism, Polygon, and more.'
          : 'Bridge from Solana, Ethereum, BNB Chain, and 20+ chains.'}
      </div>

      {/* Iframe */}
      <div className="bridge-iframe-wrapper">
        <iframe
          key={provider}
          src={provider === 'across' ? ACROSS_URL : DEBRIDGE_URL}
          title={provider === 'across' ? 'Across Bridge' : 'deBridge'}
          className="bridge-iframe"
          allow="clipboard-write; clipboard-read"
        />
      </div>

      <div className="bridge-note">
        After bridging, switch back to the Vault tab to deposit into Louis.
      </div>
    </div>
  )
}
