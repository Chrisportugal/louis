import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, formatUnits, maxUint256 } from 'viem'
import { ADDRESSES, ERC20_ABI, VAULT_ABI, ROUTER_ABI, DEPOSIT_TOKENS } from '../config/contracts'
import type { TokenInfo } from '../config/contracts'
import { SOURCE_CHAINS, USDC_BY_CHAIN } from '../config/wagmi'
import { useVaultData } from '../hooks/useVaultData'
import { useSwapQuote } from '../hooks/useSwapQuote'
import { useBridgeQuote } from '../hooks/useBridgeQuote'

type DepositStep = 'approve' | 'approveUsdhl' | 'swap' | 'deposit' | 'done'

export function VaultCard() {
  const { address, isConnected } = useAccount()
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(DEPOSIT_TOKENS[0])
  const [showTokenList, setShowTokenList] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [depositStep, setDepositStep] = useState<DepositStep | null>(null)
  const lastHandledHash = useRef<string | null>(null)
  const vaultData = useVaultData()
  const swap = useSwapQuote(selectedToken, amount)

  // Cross-chain bridge state
  const [selectedChain, setSelectedChain] = useState(999)
  const [showChainList, setShowChainList] = useState(false)
  const isBridging = selectedChain !== 999
  const isSolana = selectedChain === -1
  const chainName = SOURCE_CHAINS.find(c => c.id === selectedChain)?.name || 'HyperEVM'
  const bridgeOrigin = mode === 'deposit' ? selectedChain : 999
  const bridgeDest = mode === 'deposit' ? 999 : selectedChain
  const bridgeQuote = useBridgeQuote(bridgeOrigin, bridgeDest, amount)

  // Refs for withdraw-then-bridge flow
  const pendingBridge = useRef(false)
  const bridgeAmount = useRef('')

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

  // Read USDHL allowance for vault
  const { data: usdhlAllowance, refetch: refetchUsdhlAllowance } = useReadContract({
    address: ADDRESSES.USDHL,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, ADDRESSES.VAULT] : undefined,
    query: { enabled: !!address && mode === 'deposit', refetchInterval: 4_000 },
  })

  // Read USDHL balance (for after swap)
  const { refetch: refetchUsdhlBalance } = useReadContract({
    address: ADDRESSES.USDHL,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && swap.needsSwap, refetchInterval: 4_000 },
  })

  // Read total vault TVL
  const { data: totalAssets } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'totalAssets',
    query: { refetchInterval: 10_000 },
  })

  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Show write errors
  useEffect(() => {
    if (writeError) {
      const msg = writeError.message || 'Transaction failed'
      const match = msg.match(/reason:\s*(.+?)(?:\n|$)/) || msg.match(/Details:\s*(.+?)(?:\n|$)/)
      setError(match ? match[1] : msg.slice(0, 120))
      setDepositStep(null)
    }
  }, [writeError])

  const parsedAmount = amount && parseFloat(amount) > 0
    ? parseUnits(amount, selectedToken.decimals)
    : 0n
  const needsApproval = mode === 'deposit' && allowance !== undefined && parsedAmount > allowance
  const usdhlForVault = swap.needsSwap ? swap.expectedOut : parsedAmount
  const needsUsdhlApproval = swap.needsSwap && mode === 'deposit'
    && usdhlAllowance !== undefined && usdhlForVault > usdhlAllowance

  // ─── Action handlers ───

  const doApprove = useCallback(() => {
    setError(null)
    writeContract({
      address: selectedToken.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [approvalTarget, maxUint256],
    })
    setDepositStep('approve')
  }, [selectedToken, approvalTarget, writeContract])

  const doApproveUsdhl = useCallback(() => {
    setError(null)
    writeContract({
      address: ADDRESSES.USDHL,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ADDRESSES.VAULT, maxUint256],
    })
    setDepositStep('approveUsdhl')
  }, [writeContract])

  const doSwap = useCallback(() => {
    if (!address) return
    setError(null)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300)
    writeContract({
      address: ADDRESSES.HYPERSWAP_ROUTER,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [parsedAmount, swap.minOut, [selectedToken.address, ADDRESSES.USDHL], address, deadline],
    })
    setDepositStep('swap')
  }, [address, parsedAmount, swap.minOut, selectedToken, writeContract])

  const doDeposit = useCallback((depositAmt: bigint) => {
    if (!address) return
    setError(null)
    writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [depositAmt, address],
    })
    setDepositStep('deposit')
  }, [address, writeContract])

  // ─── Bridge URL opener (used by deposit + withdraw) ───
  const openBridgeUrl = useCallback((amt: string, direction: 'deposit' | 'withdraw') => {
    if (!amt || parseFloat(amt) <= 0) return
    const rawAmount = BigInt(Math.floor(parseFloat(amt) * 1e6)).toString()

    if (direction === 'deposit') {
      if (isSolana) {
        window.open(`https://app.debridge.com/?inputChain=7565164&outputChain=999&inputCurrency=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputCurrency=${ADDRESSES.USDHL}&amount=${amt}&dlnMode=simple`, '_blank')
      } else {
        const inputToken = USDC_BY_CHAIN[selectedChain]
        window.open(`https://app.across.to/bridge?inputToken=${inputToken}&outputToken=${ADDRESSES.USDHL}&destinationChainId=999&originChainId=${selectedChain}&amount=${rawAmount}`, '_blank')
      }
    } else {
      if (isSolana) {
        window.open(`https://app.debridge.com/?inputChain=999&outputChain=7565164&inputCurrency=${ADDRESSES.USDHL}&outputCurrency=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${amt}&dlnMode=simple`, '_blank')
      } else {
        const outputToken = USDC_BY_CHAIN[selectedChain]
        window.open(`https://app.across.to/bridge?inputToken=${ADDRESSES.USDHL}&outputToken=${outputToken}&originChainId=999&destinationChainId=${selectedChain}&amount=${rawAmount}`, '_blank')
      }
    }
  }, [selectedChain, isSolana])

  // ─── Auto-advance after tx confirms ───
  useEffect(() => {
    if (!txSuccess || !txHash || txHash === lastHandledHash.current) return
    lastHandledHash.current = txHash
    setError(null)

    // Wait for data to refresh, then auto-advance to next step
    const timer = setTimeout(async () => {
      // Await fresh on-chain data before deciding next step
      await Promise.all([refetchAllowance(), refetchUsdhlAllowance(), refetchUsdhlBalance()])
      // Reset write mutation so writeContract() works for the next tx
      resetWrite()

      if (depositStep === 'approve') {
        // Approval done — next: swap or deposit
        if (swap.needsSwap) {
          if (usdhlAllowance !== undefined && usdhlForVault > usdhlAllowance) {
            doApproveUsdhl()
          } else {
            doSwap()
          }
        } else {
          doDeposit(parsedAmount)
        }
      } else if (depositStep === 'approveUsdhl') {
        // USDHL approved — now swap
        doSwap()
      } else if (depositStep === 'swap') {
        // Swap done — now deposit actual USDHL balance
        const { data: freshUsdhl } = await refetchUsdhlBalance()
        const depositAmt = freshUsdhl ?? usdhlForVault
        resetWrite()
        doDeposit(depositAmt)
      } else if (depositStep === 'deposit') {
        // Deposit done!
        setDepositStep('done')
        setAmount('')
        setTimeout(() => setDepositStep(null), 3000)
      } else {
        // Withdraw or other — just reset
        // If pending bridge after withdrawal, open bridge URL
        if (pendingBridge.current) {
          pendingBridge.current = false
          const amt = bridgeAmount.current
          bridgeAmount.current = ''
          if (amt) openBridgeUrl(amt, 'withdraw')
        }
        setDepositStep(null)
        setAmount('')
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [txSuccess, txHash, depositStep, swap.needsSwap, parsedAmount, usdhlForVault,
      usdhlAllowance, doApproveUsdhl, doSwap, doDeposit, resetWrite,
      refetchAllowance, refetchUsdhlAllowance, refetchUsdhlBalance, openBridgeUrl])

  // ─── Single deposit button handler ───
  const handleDeposit = () => {
    if (!address || !amount || parseFloat(amount) <= 0) return
    resetWrite()
    lastHandledHash.current = null

    if (needsApproval) {
      doApprove()
    } else if (swap.needsSwap) {
      if (needsUsdhlApproval) {
        doApproveUsdhl()
      } else {
        doSwap()
      }
    } else {
      doDeposit(parsedAmount)
    }
  }

  const handleWithdraw = () => {
    if (!address) return
    setError(null)
    resetWrite()
    lastHandledHash.current = null

    const isMax = vaultShares && vaultAssets &&
      parseFloat(amount) >= parseFloat(formatUnits(vaultAssets, 6)) * 0.999

    if (isMax && vaultShares) {
      writeContract({
        address: ADDRESSES.VAULT,
        abi: VAULT_ABI,
        functionName: 'redeem',
        args: [vaultShares, address, address],
      })
    } else {
      const withdrawAmount = parseUnits(amount, 6)
      writeContract({
        address: ADDRESSES.VAULT,
        abi: VAULT_ABI,
        functionName: 'withdraw',
        args: [withdrawAmount, address, address],
      })
    }
  }

  const balance = mode === 'deposit'
    ? tokenBalance ? formatUnits(tokenBalance, selectedToken.decimals) : '0'
    : vaultAssets ? formatUnits(vaultAssets, 6) : '0'

  const handleMax = () => setAmount(balance)

  const handleSelectToken = (token: TokenInfo) => {
    setSelectedToken(token)
    setShowTokenList(false)
    setAmount('')
    setError(null)
    setDepositStep(null)
  }

  const handleSelectChain = (chainId: number) => {
    setSelectedChain(chainId)
    setShowChainList(false)
    setAmount('')
    setError(null)
    setDepositStep(null)
    if (chainId === 999) setSelectedToken(DEPOSIT_TOKENS[0])
  }

  const handleBridgeDeposit = () => {
    if (!amount || parseFloat(amount) <= 0) return
    openBridgeUrl(amount, 'deposit')
  }

  const handleWithdrawAndBridge = () => {
    if (!address || !amount || parseFloat(amount) <= 0) return
    // Save amount for after withdrawal, then do the vault withdrawal
    bridgeAmount.current = amount
    pendingBridge.current = true
    handleWithdraw()
  }

  const depositAmount = swap.needsSwap ? swap.expectedOut : parsedAmount
  const annualYield = depositAmount > 0n && vaultData.totalApy
    ? (parseFloat(formatUnits(depositAmount, 6)) * vaultData.totalApy / 100).toFixed(2)
    : '0.00'

  // ─── Button state ───
  const isWorking = isPending || isConfirming || (depositStep !== null && depositStep !== 'done')
  const getButtonLabel = () => {
    if (mode === 'withdraw') return isPending || isConfirming ? 'Withdrawing...' : 'Withdraw'
    if (depositStep === 'done') return '✓ Deposited!'
    if (isWorking) {
      if (depositStep === 'approve') return 'Approving...'
      if (depositStep === 'approveUsdhl') return 'Approving USDHL...'
      if (depositStep === 'swap') return 'Swapping...'
      if (depositStep === 'deposit') return 'Depositing...'
      return 'Confirming...'
    }
    return 'Deposit'
  }

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
          onClick={() => { setMode('deposit'); setSelectedToken(DEPOSIT_TOKENS[0]); setError(null); setDepositStep(null) }}
        >
          Deposit
        </button>
        <button
          className={mode === 'withdraw' ? 'active' : ''}
          onClick={() => { setMode('withdraw'); setError(null); setDepositStep(null) }}
        >
          Withdraw
        </button>
      </div>

      {/* Chain Selector — deposit: "From", withdraw: "To" */}
      <div className="chain-selector-group">
        <div className="input-header">
          <span className="input-label">{mode === 'deposit' ? 'From' : 'To'}</span>
        </div>
        <div className="chain-selector" onClick={() => !isWorking && setShowChainList(!showChainList)}>
          <span className="chain-name">{chainName}</span>
          <span className="token-arrow">{showChainList ? '\u25B2' : '\u25BC'}</span>
          {showChainList && (
            <div className="chain-dropdown">
              {SOURCE_CHAINS.map((chain) => (
                <div
                  key={chain.id}
                  className={`chain-option ${chain.id === selectedChain ? 'selected' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleSelectChain(chain.id) }}
                >
                  {chain.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="input-group">
        <div className="input-header">
          <span className="input-label">{mode === 'deposit' && isBridging ? 'Amount (USDC)' : 'Amount'}</span>
          {!(mode === 'deposit' && isBridging) && (
            <span className="input-balance">
              Balance: {parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {mode === 'deposit' ? selectedToken.symbol : 'louisUSD'}
            </span>
          )}
        </div>
        <div className="input-wrapper">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); setDepositStep(null) }}
            min="0"
            step="0.01"
            disabled={isWorking && !(mode === 'deposit' && isBridging)}
          />
          <div className="input-right">
            {!(mode === 'deposit' && isBridging) && <button className="max-btn" onClick={handleMax} disabled={isWorking}>MAX</button>}
            {mode === 'deposit' ? (
              isBridging ? (
                <span className="token-badge">USDC</span>
              ) : (
                <div className="token-selector" onClick={() => !isWorking && setShowTokenList(!showTokenList)}>
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
              )
            ) : (
              <span className="token-badge">louisUSD</span>
            )}
          </div>
        </div>
      </div>

      {/* Swap estimate (HyperEVM only) */}
      {mode === 'deposit' && !isBridging && swap.needsSwap && swap.expectedOut > 0n && (
        <div className="swap-estimate">
          <span>Estimated deposit</span>
          <span className="swap-value">~${parseFloat(formatUnits(swap.expectedOut, 6)).toFixed(2)}</span>
        </div>
      )}

      {/* Bridge estimate (cross-chain) */}
      {mode === 'deposit' && isBridging && !isSolana && amount && parseFloat(amount) > 0 && (
        bridgeQuote.loading ? (
          <div className="bridge-estimate">
            <span className="bridge-loading">Fetching bridge quote...</span>
          </div>
        ) : bridgeQuote.error ? (
          <div className="bridge-estimate error">
            <span>{bridgeQuote.error}</span>
          </div>
        ) : bridgeQuote.outputAmount > 0n ? (
          <div className="bridge-estimate">
            <div className="bridge-row">
              <span>You'll receive</span>
              <span className="bridge-value">~{parseFloat(formatUnits(bridgeQuote.outputAmount, 6)).toFixed(2)} USDHL</span>
            </div>
            <div className="bridge-row">
              <span>Bridge fee</span>
              <span>~${parseFloat(formatUnits(bridgeQuote.totalFee, 6)).toFixed(2)}</span>
            </div>
            <div className="bridge-row">
              <span>Est. time</span>
              <span>{bridgeQuote.estimatedTime < 60 ? `~${bridgeQuote.estimatedTime}s` : `~${Math.ceil(bridgeQuote.estimatedTime / 60)} min`}</span>
            </div>
          </div>
        ) : null
      )}

      {/* Solana bridge info (deposit) */}
      {mode === 'deposit' && isSolana && amount && parseFloat(amount) > 0 && (
        <div className="bridge-estimate">
          <div className="bridge-row">
            <span>Bridge via deBridge</span>
            <span className="bridge-value">USDC → USDHL</span>
          </div>
          <div className="bridge-row">
            <span>Destination</span>
            <span>HyperEVM</span>
          </div>
        </div>
      )}

      {/* Bridge estimate (withdraw to other chain) */}
      {mode === 'withdraw' && isBridging && !isSolana && amount && parseFloat(amount) > 0 && (
        bridgeQuote.loading ? (
          <div className="bridge-estimate">
            <span className="bridge-loading">Fetching bridge quote...</span>
          </div>
        ) : bridgeQuote.error ? (
          <div className="bridge-estimate error">
            <span>{bridgeQuote.error}</span>
          </div>
        ) : bridgeQuote.outputAmount > 0n ? (
          <div className="bridge-estimate">
            <div className="bridge-row">
              <span>You'll receive on {chainName}</span>
              <span className="bridge-value">~{parseFloat(formatUnits(bridgeQuote.outputAmount, 6)).toFixed(2)} USDC</span>
            </div>
            <div className="bridge-row">
              <span>Bridge fee</span>
              <span>~${parseFloat(formatUnits(bridgeQuote.totalFee, 6)).toFixed(2)}</span>
            </div>
            <div className="bridge-row">
              <span>Est. time</span>
              <span>{bridgeQuote.estimatedTime < 60 ? `~${bridgeQuote.estimatedTime}s` : `~${Math.ceil(bridgeQuote.estimatedTime / 60)} min`}</span>
            </div>
          </div>
        ) : null
      )}

      {/* Solana bridge info (withdraw) */}
      {mode === 'withdraw' && isSolana && amount && parseFloat(amount) > 0 && (
        <div className="bridge-estimate">
          <div className="bridge-row">
            <span>Bridge via deBridge</span>
            <span className="bridge-value">USDHL → USDC</span>
          </div>
          <div className="bridge-row">
            <span>Destination</span>
            <span>Solana</span>
          </div>
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

      {/* Action Button */}
      {mode === 'deposit' && isBridging ? (
        <button
          className="action-btn"
          onClick={handleBridgeDeposit}
          disabled={!amount || parseFloat(amount) <= 0}
        >
          {isSolana ? 'Bridge via deBridge' : 'Bridge via Across'}
        </button>
      ) : mode === 'withdraw' && isBridging ? (
        isConnected ? (
          <button
            className="action-btn"
            onClick={handleWithdrawAndBridge}
            disabled={!amount || parseFloat(amount) <= 0 || isWorking}
          >
            {isPending || isConfirming ? 'Withdrawing...' : isSolana ? 'Withdraw & Bridge (deBridge)' : 'Withdraw & Bridge (Across)'}
          </button>
        ) : (
          <div className="connect-prompt">Connect wallet to withdraw</div>
        )
      ) : isConnected ? (
        <button
          className="action-btn"
          onClick={mode === 'withdraw' ? handleWithdraw : handleDeposit}
          disabled={!amount || parseFloat(amount) <= 0 || isWorking}
        >
          {getButtonLabel()}
        </button>
      ) : (
        <div className="connect-prompt">Connect wallet to {mode}</div>
      )}
    </div>
  )
}
