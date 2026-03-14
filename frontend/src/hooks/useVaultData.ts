import { useState, useEffect, useCallback } from 'react'

interface ProtocolYield {
  name: string
  apy: number
  tvl: number
  type: 'aave' | 'erc4626'
}

interface VaultData {
  totalApy: number
  totalTvl: number
  protocols: ProtocolYield[]
  loading: boolean
}

const MORPHO_API = 'https://api.morpho.org/graphql'

async function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 8000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timeout)
    return res
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

async function fetchFelixVaults(): Promise<ProtocolYield[]> {
  const query = `{
    vaults(where: { chainId_in: [999] }, orderBy: TotalAssetsUsd, orderDirection: Desc) {
      items {
        address
        name
        asset { symbol }
        state { totalAssetsUsd netApy }
      }
    }
  }`

  try {
    const res = await fetchWithTimeout(MORPHO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const data = await res.json() as any
    const vaults = data?.data?.vaults?.items ?? []

    return vaults
      .filter((v: any) => v.asset?.symbol?.toLowerCase().includes('usd'))
      .slice(0, 5)
      .map((v: any) => ({
        name: v.name || 'Felix Vault',
        apy: (v.state?.netApy ?? 0) * 100,
        tvl: v.state?.totalAssetsUsd ?? 0,
        type: 'erc4626' as const,
      }))
  } catch {
    return []
  }
}

async function fetchAaveRates(): Promise<ProtocolYield[]> {
  try {
    const res = await fetchWithTimeout('https://yields.llama.fi/pools', {}, 10000)
    const data = await res.json() as any
    const pools = data?.data ?? []

    const hyperPools = pools.filter(
      (p: any) =>
        (p.chain === 'Hyperliquid' || p.chain === 'HyperEVM') &&
        p.symbol?.toLowerCase().includes('usd')
    )

    return hyperPools.slice(0, 4).map((p: any) => ({
      name: p.project
        ? `${p.project.charAt(0).toUpperCase() + p.project.slice(1)} ${p.symbol}`
        : p.pool,
      apy: p.apy ?? 0,
      tvl: p.tvlUsd ?? 0,
      type: 'aave' as const,
    }))
  } catch {
    return []
  }
}

export function useVaultData(): VaultData {
  const [data, setData] = useState<VaultData>({
    totalApy: 0,
    totalTvl: 0,
    protocols: [],
    loading: true,
  })

  const refresh = useCallback(async () => {
    try {
      // Fetch both sources in parallel
      const [felix, aave] = await Promise.all([
        fetchFelixVaults().catch(() => []),
        fetchAaveRates().catch(() => []),
      ])

      const all = [...aave, ...felix].sort((a, b) => b.apy - a.apy)

      if (all.length > 0) {
        setData({
          totalApy: all[0].apy,
          totalTvl: all.reduce((sum, p) => sum + p.tvl, 0),
          protocols: all,
          loading: false,
        })
      } else {
        // Both APIs failed — stop loading but keep any previous data
        setData(prev => ({ ...prev, loading: false }))
      }
    } catch {
      setData(prev => ({ ...prev, loading: false }))
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 60_000)
    return () => clearInterval(interval)
  }, [refresh])

  return data
}
