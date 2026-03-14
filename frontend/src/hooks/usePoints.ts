import { useEffect, useState } from 'react'
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

// ─── Points Storage ───
// We track points incrementally: each visit, compute new points from
// (current_usd_value × hours_since_last_snapshot / 24), add to accumulated total.
// Stored per-address in localStorage.

interface PointsSnapshot {
  points: number
  lastCheckedAt: number // Unix ms
  lastValueUsd: number  // USD value at last check
}

const STORAGE_KEY = 'louis-points-'

function loadSnapshot(address: string): PointsSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + address.toLowerCase())
    if (raw) return JSON.parse(raw)
  } catch {}
  return { points: 0, lastCheckedAt: Date.now(), lastValueUsd: 0 }
}

function saveSnapshot(address: string, snapshot: PointsSnapshot) {
  localStorage.setItem(
    STORAGE_KEY + address.toLowerCase(),
    JSON.stringify(snapshot)
  )
}

// ─── Hook ───
export interface PointsData {
  points: number
  league: League
  dailyRate: number  // points earned per day at current value
  loading: boolean
}

export function usePoints(): PointsData {
  const { address, isConnected } = useAccount()
  const [points, setPoints] = useState(0)
  const [dailyRate, setDailyRate] = useState(0)

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
      setPoints(0)
      setDailyRate(0)
      return
    }

    // USD value (USDHL has 6 decimals, ~$1 each)
    const currentUsd = assetsValue ? Number(formatUnits(assetsValue, 6)) : 0

    // Load previous snapshot
    const snapshot = loadSnapshot(address)
    const now = Date.now()
    const hoursSinceLastCheck = (now - snapshot.lastCheckedAt) / (1000 * 60 * 60)

    // Accumulate points: use average of last known value and current value
    // (handles deposits/withdrawals between checks more fairly)
    const avgValue = (snapshot.lastValueUsd + currentUsd) / 2
    const newPoints = avgValue * (hoursSinceLastCheck / 24)
    const totalPoints = snapshot.points + newPoints

    // Save updated snapshot
    const updated: PointsSnapshot = {
      points: totalPoints,
      lastCheckedAt: now,
      lastValueUsd: currentUsd,
    }
    saveSnapshot(address, updated)

    setPoints(totalPoints)
    setDailyRate(currentUsd) // 1 point per $1 per day
  }, [address, isConnected, assetsValue])

  return {
    points,
    league: getLeague(points),
    dailyRate,
    loading,
  }
}
