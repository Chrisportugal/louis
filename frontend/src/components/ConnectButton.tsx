import { useAccount, useConnect, useDisconnect } from 'wagmi'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <button className="connect-btn connected" onClick={() => disconnect()}>
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    )
  }

  return (
    <button
      className="connect-btn"
      onClick={() => {
        const connector = connectors[0]
        if (connector) connect({ connector })
      }}
    >
      Connect Wallet
    </button>
  )
}
