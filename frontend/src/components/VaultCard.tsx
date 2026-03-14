import { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, formatUnits, maxUint256 } from 'viem'
import { ADDRESSES, ERC20_ABI, VAULT_ABI, ROUTER_ABI, DEPOSIT_TOKENS } from '../config/contracts'
import type { TokenInfo } from '../config/contracts'
import { useVaultData } from '../hooks/useVaultData'
import { useSwapQuote } from '../hooks/useSwapQuote'

export function VaultCard() {
  const { address, isConnected } = useAccount()
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(DEPOSIT_TOKENS[0])
  const [showTokenList, setShowTokenList] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vaultData = useVaultData()
  const swap = useSwapQuote(selectedToken, amount)

  // Read selected token balance
  const { data: tokenBalance } = useReadContract({
    address: selectedToken.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 4_000 },
  })

  // Read vault share balance
  const { data: vaultShares } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 4_000 },
  })

  // Convert shares to assets
  const { data: vaultAssets } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'convertToAssets',
    args: vaultShares ? [vaultShares] : undefined,
    query: { enabled: !!vaultShares && vaultShares > 0n },
  })

  // Read allowance for selected token → router or vault
  const approvalTarget = swap.needsSwap ? ADDRESSES.HYPERSWAP_ROUTER : ADDRESSES.VAULT
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: selectedToken.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, approvalTarget] : undefined,
    query: { enabled: !!address && mode === 'deposit', refetchInterval: 4_000 },
  })

  // Read USDHL allowance for vault (needed after swap)
  const { data: usdhlAllowance, refetch: refetchUsdhlAllowance } = useReadContract({
    address: ADDRESSES.USDHL,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, ADDRESSES.VAULT] : undefined,
    query: { enabled: !!address && mode === 'deposit', refetchInterval: 4_000 },
  })

  // Read total vault TVL
  const { data: totalAssets } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'totalAssets',
    query: { refetchInterval: 10_000 },
  })

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Refetch allowances after tx confirms
  useEffect(() => {
    if (txSuccess) {
      refetchAllowance()
      refetchUsdhlAllowance()
      setError(null)
    }
  }, [txSuccess, refetchAllowance, refetchUsdhlAllowance])

  // Show write errors
  useEffect(() => {
    if (writeError) {
      const msg = writeError.message || 'Transaction failed'
      // Extract short error message
      const match = msg.match(/reason:\s*(.+?)(?:\n|$)/) || msg.match(/Details:\s*(.+?)(?:\n|$)/)
      setError(match ? match[1] : msg.slice(0, 120))
    }
  }, [writeError])

  const balance = mode === 'deposit'
    ? tokenBalance ? formatUnits(tokenBalance, selectedToken.decimals) : '0'
    : vaultAssets ? formatUnits(vaultAssets, 6) : '0'

  const parsedAmount = amount && parseFloat(amount) > 0
    ? parseUnits(amount, selectedToken.decimals)
    : 0n
  const needsApproval = mode === 'deposit' && allowance !== undefined && parsedAmount > allowance

  // For swap flow: after swapping, check if USDHL needs approval for vault
  const usdhlForVault = swap.needsSwap ? swap.expectedOut : parsedAmount
  const needsUsdhlApproval = swap.needsSwap && mode === 'deposit'
    && usdhlAllowance !== undefined && usdhlForVault > usdhlAllowance

  const depositAmount = swap.needsSwap ? swap.expectedOut : parsedAmount
  const annualYield = depositAmount > 0n && vaultData.totalApy
    ? (parseFloat(formatUnits(depositAmount, 6)) * vaultData.totalApy / 100).toFixed(2)
    : '0.00'

  const handleMax = () => setAmount(balance)

  const handleSelectToken = (token: TokenInfo) => {
    setSelectedToken(token)
    setShowTokenList(false)
    setAmount('')
    setError(null)
  }

  // Step 1: Approve input token for router (swap) or vault (direct) — max approval
  const handleApprove = () => {
    setError(null)
    writeContract({
      address: selectedToken.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [approvalTarget, maxUint256],
    })
  }

  // Step 2: Swap via HyperSwap
  const handleSwap = () => {
    if (!address) return
    setError(null)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300) // 5 min
    writeContract({
      address: ADDRESSES.HYPERSWAP_ROUTER,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [parsedAmount, swap.minOut, [selectedToken.address, ADDRESSES.USDHL], address, deadline],
    })
  }

  // Step 3: Approve USDHL for vault (after swap) — max approval
  const handleApproveUsdhl = () => {
    setError(null)
    writeContract({
      address: ADDRESSES.USDHL,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.VAULT, maxUint256],
    })
  }

  // Step 4: Deposit USDHL into vault
  const handleDeposit = () => {
    if (!address) return
    setError(null)
    // For direct USDHL deposits, use parsedAmount. For post-swap, use actual USDHL balance
    const depositAmt = swap.needsSwap ? usdhlForVault : parsedAmount
    writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [depositAmt, address],
    })
  }

  const handleWithdraw = () => {
    if (!address) return
    setError(null)
    const withdrawAmount = parseUnits(amount, 6)
    writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [withdrawAmount, address, address],
    })
  }

  // Determine current action step
  const getAction = () => {
    if (mode === 'withdraw') return { label: 'Withdraw', handler: handleWithdraw, step: '' }
    if (needsApproval) return { label: 'Deposit', handler: handleApprove, step: `Step 1: Approve ${selectedToken.symbol}` }
    if (swap.needsSwap) {
      if (needsUsdhlApproval) return { label: 'Deposit', handler: handleApproveUsdhl, step: 'Step 2: Approve USDHL' }
      return { label: 'Deposit', handler: handleSwap, step: 'Step 2: Swap to USDHL' }
    }
    return { label: 'Deposit', handler: handleDeposit, step: '' }
  }

  const action = getAction()
  const buttonLabel = isPending || isConfirming ? 'Confirming...' : action.label

  const vaultTvl = totalAssets ? parseFloat(formatUnits(totalAssets, 6)) : 0

  return (
    <div className="vault-card">
      <div className="vault-header">
        <h2 className="vault-name">Louis USD</h2>
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
              : '$0'}
          </span>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button
          className={mode === 'deposit' ? 'active' : ''}
          onClick={() => { setMode('deposit'); setSelectedToken(DEPOSIT_TOKENS[0]); setError(null) }}
        >
          Deposit
        </button>
        <button
          className={mode === 'withdraw' ? 'active' : ''}
          onClick={() => { setMode('withdraw'); setError(null) }}
        >
          Withdraw
        </button>
      </div>

      {/* Input */}
      <div className="input-group">
        <div className="input-header">
          <span className="input-label">Amount</span>
          <span className="input-balance">
            Balance: {parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {mode === 'deposit' ? selectedToken.symbol : 'louisUSD'}
          </span>
        </div>
        <div className="input-wrapper">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null) }}
            min="0"
            step="0.01"
          />
          <div className="input-right">
            <button className="max-btn" onClick={handleMax}>MAX</button>
            {mode === 'deposit' ? (
              <div className="token-selector" onClick={() => setShowTokenList(!showTokenList)}>
                <span className="token-badge clickable">{selectedToken.symbol}</span>
                <span className="token-arrow">{showTokenList ? '\u25B2' : '\u25BC'}</span>
                {showTokenList && (
                  <div className="token-dropdown">
                    {DEPOSIT_TOKENS.map((t) => (
                      <div
                        key={t.symbol}
                        className={`token-option ${t.symbol === selectedToken.symbol ? 'selected' : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleSelectToken(t) }}
                      >
                        {t.symbol}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="token-badge">louisUSD</span>
            )}
          </div>
        </div>
      </div>

      {/* Swap estimate */}
      {mode === 'deposit' && swap.needsSwap && swap.expectedOut > 0n && (
        <div className="swap-estimate">
          <span>You receive</span>
          <span className="swap-value">~{parseFloat(formatUnits(swap.expectedOut, 6)).toFixed(2)} USDHL</span>
        </div>
      )}

      {/* Est. Annual Yield */}
      {mode === 'deposit' && amount && parseFloat(amount) > 0 && (
        <div className="yield-estimate">
          <span>Est. Annual Yield</span>
          <span className="yield-value">${annualYield}</span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="error-msg" style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Step indicator */}
      {action.step && (
        <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px', textAlign: 'center' }}>
          {action.step}
        </div>
      )}

      {/* Action Button */}
      {isConnected ? (
        <button
          className="action-btn"
          onClick={action.handler}
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
