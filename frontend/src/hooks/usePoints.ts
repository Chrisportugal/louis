import { useState, useEffect } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { ADDRESSES, VAULT_ABI } from '../config/contracts'

// ─── Leagues ───
export interface League {
  name: string
  icon: string
  minPoints: number
  color: string
}

export const LEAGUES: League[] = [
  { name: 'Wood',     icon: '🪵', minPoints: 0,       color: '#8B6914' },
  { name: 'Bronze',   icon: '🥉', minPoints: 100,     color: '#CD7F32' },
  { name: 'Silver',   icon: '🥈', minPoints: 1_000,   color: '#C0C0C0' },
  { name: 'Gold',     icon: '🥇', minPoints: 10_000,  color: '#FFD700' },
  { name: 'Platinum', icon: '💎', minPoints: 100_000, color: '#7DF9FF' },
]

export function getLeague(points: number): League {
  for (let i = LEAGUES.length - 1; i >= 0; i--) {
    if (points >= LEAGUES[i].minPoints) return LEAGUES[i]
  }
  return LEAGUES[0]
}

// ─── Points Model ───
// 1 point = $1 deposited in the vault (real-time, based on current balance)
// Users earn yield normally but 20% fee goes to $LOUIS buybacks
// Points are only kept if user keeps funds deposited until TGE
// Withdraw = lose points (proportionally)
// At TGE: convert points → $LOUIS tokens OR exercise put option

export const PERFORMANCE_FEE = 0.20 // 20% of yield goes to $LOUIS buybacks

// ─── Hook ───
export interface PointsData {
  points: number        // = current USD deposit (1 pt per $1)
  league: League
  depositUsd: number    // current deposit in USD
  loading: boolean
}

export function usePoints(): PointsData {
  const { address, isConnected } = useAccount()
  const [depositUsd, setDepositUsd] = useState(0)

  // Read user's vault shares
  const { data: shares } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  })

  // Convert shares to USD value
  const { data: assetsValue } = useReadContract({
    address: ADDRESSES.VAULT,
    abi: VAULT_ABI,
    functionName: 'convertToAssets',
    args: shares ? [shares] : undefined,
    query: { enabled: !!shares && shares > 0n, refetchInterval: 10_000 },
  })

  const loading = !isConnected || shares === undefined

  useEffect(() => {
    if (!address || !isConnected) {
      setDepositUsd(0)
      return
    }

    // USD value (USDHL has 6 decimals, ~$1 each)
    const currentUsd = assetsValue ? Number(formatUnits(assetsValue, 6)) : 0
    setDepositUsd(currentUsd)
  }, [address, isConnected, assetsValue])

  // Points = current deposit in USD (1:1)
  const points = depositUsd

  return {
    points,
    league: getLeague(points),
    depositUsd,
    loading,
  }
}
