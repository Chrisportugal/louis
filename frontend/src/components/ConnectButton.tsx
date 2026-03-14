import { useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const [showOptions, setShowOptions] = useState(false)

  if (isConnected && address) {
    return (
      <button className="connect-btn connected" onClick={() => disconnect()}>
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    )
  }

  const handleConnect = () => {
    // If only one connector available (or on mobile), try the best one
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

    if (isMobile) {
      // On mobile, prefer WalletConnect (shows QR or deeplinks to wallet apps)
      const wc = connectors.find(c => c.id === 'walletConnect')
      if (wc) {
        connect({ connector: wc })
        return
      }
    }

    // On desktop with multiple connectors, show options
    if (connectors.length > 1) {
      setShowOptions(!showOptions)
    } else if (connectors[0]) {
      connect({ connector: connectors[0] })
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="connect-btn" onClick={handleConnect}>
        Connect Wallet
      </button>
      {showOptions && (
        <div className="wallet-options">
          {connectors.map((connector) => (
            <button
              key={connector.id}
              className="wallet-option"
              onClick={() => {
                connect({ connector })
                setShowOptions(false)
              }}
            >
              {connector.id === 'injected' ? 'Browser Wallet' : connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
