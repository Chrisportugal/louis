import { useState, useEffect } from 'react'
import { USDC_BY_CHAIN } from '../config/wagmi'

// USDHL on HyperEVM (destination token)
const USDHL = '0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5'
const ACROSS_API = 'https://across.to/api'

export interface BridgeQuote {
  outputAmount: bigint
  totalFee: bigint
  estimatedTime: number // seconds
  loading: boolean
  error: string | null
}

/**
 * Fetches a bridge quote from Across API for bridging USDC from a source chain
 * to USDHL on HyperEVM (chain 999).
 */
export function useBridgeQuote(
  sourceChainId: number,
  amount: string, // human-readable e.g. "100"
): BridgeQuote {
  const [quote, setQuote] = useState<BridgeQuote>({
    outputAmount: 0n,
    totalFee: 0n,
    estimatedTime: 0,
    loading: false,
    error: null,
  })

  useEffect(() => {
    // Only fetch if bridging from another chain
    if (sourceChainId === 999 || !amount || parseFloat(amount) <= 0) {
      setQuote({ outputAmount: 0n, totalFee: 0n, estimatedTime: 0, loading: false, error: null })
      return
    }

    const inputToken = USDC_BY_CHAIN[sourceChainId]
    if (!inputToken) {
      setQuote(q => ({ ...q, error: 'Unsupported chain', loading: false }))
      return
    }

    const rawAmount = BigInt(Math.floor(parseFloat(amount) * 1e6)).toString()

    const controller = new AbortController()
    setQuote(q => ({ ...q, loading: true, error: null }))

    const params = new URLSearchParams({
      inputToken,
      outputToken: USDHL,
      originChainId: sourceChainId.toString(),
      destinationChainId: '999',
      amount: rawAmount,
    })

    fetch(`${ACROSS_API}/suggested-fees?${params}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`Across API error: ${res.status}`)
        return res.json()
      })
      .then((data: any) => {
        const totalFee = BigInt(data.totalRelayFee?.total ?? '0')
        const inputBig = BigInt(rawAmount)
        const outputAmount = inputBig > totalFee ? inputBig - totalFee : 0n
        const estimatedTime = data.estimatedFillTimeSec ?? 60

        setQuote({
          outputAmount,
          totalFee,
          estimatedTime,
          loading: false,
          error: null,
        })
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setQuote({
            outputAmount: 0n,
            totalFee: 0n,
            estimatedTime: 0,
            loading: false,
            error: err.message?.includes('Across') ? 'Route not available' : err.message,
          })
        }
      })

    return () => controller.abort()
  }, [sourceChainId, amount])

  return quote
}
