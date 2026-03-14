import { useReadContract } from 'wagmi'
import { parseUnits } from 'viem'
import { ADDRESSES, ROUTER_ABI } from '../config/contracts'
import type { TokenInfo } from '../config/contracts'

const SLIPPAGE_BPS = 50 // 0.5%

export function useSwapQuote(token: TokenInfo, amount: string) {
  const needsSwap = token.address !== ADDRESSES.USDHL
  const parsedAmount = amount && parseFloat(amount) > 0
    ? parseUnits(amount, token.decimals)
    : 0n

  const { data: amountsOut } = useReadContract({
    address: ADDRESSES.HYPERSWAP_ROUTER,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [parsedAmount, [token.address, ADDRESSES.USDHL]],
    query: {
      enabled: needsSwap && parsedAmount > 0n,
      refetchInterval: 15_000, // refresh every 15s
    },
  })

  const expectedOut = amountsOut ? (amountsOut as bigint[])[1] : 0n
  const minOut = expectedOut > 0n
    ? expectedOut - (expectedOut * BigInt(SLIPPAGE_BPS)) / 10_000n
    : 0n

  return {
    needsSwap,
    expectedOut,
    minOut,
    slippageBps: SLIPPAGE_BPS,
  }
}
