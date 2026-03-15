import { useState, useEffect } from 'react'
import { USDC_BY_CHAIN } from '../config/wagmi'

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
 * Fetches a bridge quote from Across API.
 *
 * Deposit direction:  originChainId → 999  (USDC on source → USDHL on HyperEVM)
 * Withdraw direction: 999 → destinationChainId (USDHL on HyperEVM → USDC on dest)
 */
export function useBridgeQuote(
  originChainId: number,
  destinationChainId: number,
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
    // No bridging needed if same chain or invalid amount
    if (
      originChainId === destinationChainId ||
      !amount ||
      parseFloat(amount) <= 0
    ) {
      setQuote({ outputAmount: 0n, totalFee: 0n, estimatedTime: 0, loading: false, error: null })
      return
    }

    // Determine tokens based on direction
    let inputToken: string | undefined
    let outputToken: string | undefined

    if (originChainId !== 999 && destinationChainId === 999) {
      // Deposit: USDC on source chain → USDHL on HyperEVM
      inputToken = USDC_BY_CHAIN[originChainId]
      outputToken = USDHL
    } else if (originChainId === 999 && destinationChainId !== 999) {
      // Withdraw: USDHL on HyperEVM → USDC on destination
      inputToken = USDHL
      outputToken = USDC_BY_CHAIN[destinationChainId]
    }

    if (!inputToken || !outputToken) {
      setQuote(q => ({ ...q, error: 'Unsupported route', loading: false }))
      return
    }

    const rawAmount = BigInt(Math.floor(parseFloat(amount) * 1e6)).toString()

    const controller = new AbortController()
    setQuote(q => ({ ...q, loading: true, error: null }))

    const params = new URLSearchParams({
      inputToken,
      outputToken,
      originChainId: originChainId.toString(),
      destinationChainId: destinationChainId.toString(),
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
  }, [originChainId, destinationChainId, amount])

  return quote
}
