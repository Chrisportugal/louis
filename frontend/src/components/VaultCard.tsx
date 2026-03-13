import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { ADDRESSES, ERC20_ABI, VAULT_ABI } from '../config/contracts'
import { useVaultData } from '../hooks/useVaultData'

export function VaultCard() {
  const { address, isConnected } = useAccount()
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const vaultData = useVaultData()

  // Read USDHL balance
  const { data: usdhlBalance } = useReadContract({
    address: ADDRESSES.USDHL,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  // Read vault share balance
  const { data: vaultShares } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && ADDRESSES.VAULT !== '0x0000000000000000000000000000000000000000' },
  })

  // Convert shares to assets
  const { data: vaultAssets } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'convertToAssets',
    args: vaultShares ? [vaultShares] : undefined,
    query: { enabled: !!vaultShares && vaultShares > 0n },
  })

  // Read allowance
  const { data: allowance } = useReadContract({
    address: ADDRESSES.USDHL,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, ADDRESSES.VAULT] : undefined,
    query: { enabled: !!address },
  })

  // Read total vault TVL
  const { data: totalAssets } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'totalAssets',
    query: { enabled: ADDRESSES.VAULT !== '0x0000000000000000000000000000000000000000' },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  const balance = mode === 'deposit'
    ? usdhlBalance ? formatUnits(usdhlBalance, 6) : '0'
    : vaultAssets ? formatUnits(vaultAssets, 6) : '0'

  const parsedAmount = amount ? parseUnits(amount, 6) : 0n
  const needsApproval = mode === 'deposit' && allowance !== undefined && parsedAmount > allowance

  const annualYield = amount && vaultData.totalApy
    ? (parseFloat(amount) * vaultData.totalApy / 100).toFixed(2)
    : '0.00'

  const handleMax = () => {
    setAmount(balance)
  }

  const handleApprove = () => {
    writeContract({
      address: ADDRESSES.USDHL,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.VAULT, parsedAmount],
    })
  }

  const handleDeposit = () => {
    if (!address) return
    writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [parsedAmount, address],
    })
  }

  const handleWithdraw = () => {
    if (!address) return
    writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [parsedAmount, address, address],
    })
  }

  const handleAction = () => {
    if (needsApproval) {
      handleApprove()
    } else if (mode === 'deposit') {
      handleDeposit()
    } else {
      handleWithdraw()
    }
  }

  const buttonLabel = isPending || isConfirming
    ? 'Confirming...'
    : needsApproval
      ? 'Approve USDHL'
      : mode === 'deposit'
        ? 'Deposit'
        : 'Withdraw'

  const vaultTvl = totalAssets
    ? parseFloat(formatUnits(totalAssets, 6))
    : 0

  return (
    <div className="vault-card">
      {/* Header */}
      <div className="vault-header">
        <div className="vault-title-row">
          <div className="vault-icon">L</div>
          <div>
            <h2 className="vault-name">Louis USDHL</h2>
            <p className="vault-subtitle">Yield Agent on HyperEVM</p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="stats-row">
        <div className="stat">
          <span className="stat-label">APY</span>
          <span className="stat-value apy">
            {vaultData.loading ? '—' : `${vaultData.totalApy.toFixed(2)}%`}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">TVL</span>
          <span className="stat-value">
            {vaultTvl > 0
              ? `$${vaultTvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : vaultData.loading
                ? '—'
                : `$${(vaultData.totalTvl / 1e6).toFixed(2)}M`}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Asset</span>
          <span className="stat-value">USDHL</span>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button
          className={mode === 'deposit' ? 'active' : ''}
          onClick={() => setMode('deposit')}
        >
          Deposit
        </button>
        <button
          className={mode === 'withdraw' ? 'active' : ''}
          onClick={() => setMode('withdraw')}
        >
          Withdraw
        </button>
      </div>

      {/* Input */}
      <div className="input-group">
        <div className="input-header">
          <span className="input-label">Amount</span>
          <span className="input-balance">
            Balance: {parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {mode === 'deposit' ? 'USDHL' : 'lUSDHL'}
          </span>
        </div>
        <div className="input-wrapper">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
          />
          <div className="input-right">
            <button className="max-btn" onClick={handleMax}>MAX</button>
            <span className="token-badge">USDHL</span>
          </div>
        </div>
      </div>

      {/* Est. Annual Yield */}
      {mode === 'deposit' && amount && parseFloat(amount) > 0 && (
        <div className="yield-estimate">
          <span>Est. Annual Yield</span>
          <span className="yield-value">${annualYield}</span>
        </div>
      )}

      {/* Protocols */}
      {vaultData.protocols.length > 0 && (
        <div className="protocols-section">
          <span className="protocols-label">Active Protocols</span>
          <div className="protocol-list">
            {vaultData.protocols.slice(0, 4).map((p, i) => (
              <div key={i} className="protocol-row">
                <span className="protocol-name">
                  <span className={`protocol-dot ${p.type}`} />
                  {p.name}
                </span>
                <span className="protocol-apy">{p.apy.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Button */}
      {isConnected ? (
        <button
          className="action-btn"
          onClick={handleAction}
          disabled={!amount || parseFloat(amount) <= 0 || isPending || isConfirming}
        >
          {buttonLabel}
        </button>
      ) : (
        <div className="connect-prompt">Connect wallet to {mode}</div>
      )}
    </div>
  )
}
