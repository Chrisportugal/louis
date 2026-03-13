/**
 * Yield Monitor — HyperEVM Lending Protocols
 *
 * Fetches live APY data from:
 *  1. DefiLlama Yields API (all protocols, one call)
 *  2. On-chain reads from HyperLend + HypurrFi (Aave V3 pattern)
 *  3. Morpho GraphQL API (Felix Vanilla Markets)
 *
 * Run: npm run monitor
 */

import { createPublicClient, http, formatUnits } from 'viem'

// ─── HyperEVM Client ───
const client = createPublicClient({
  chain: {
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  },
  transport: http(),
})

// ─── Protocol Addresses ───
const PROTOCOLS = {
  hyperLend: {
    name: 'HyperLend',
    pool: '0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b' as `0x${string}`,
  },
  hypurrFi: {
    name: 'HypurrFi',
    pool: '0xceCcE0EB9DD2Ef7996e01e25DD70e461F918A14b' as `0x${string}`,
  },
} as const

// Aave V3 getReserveData ABI (works for both HyperLend and HypurrFi)
const POOL_ABI = [
  {
    name: 'getReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'configuration', type: 'uint256' },
        { name: 'liquidityIndex', type: 'uint128' },
        { name: 'currentLiquidityRate', type: 'uint128' },  // Supply APY (ray)
        { name: 'variableBorrowIndex', type: 'uint128' },
        { name: 'currentVariableBorrowRate', type: 'uint128' },  // Borrow APY (ray)
        { name: 'currentStableBorrowRate', type: 'uint128' },
        { name: 'lastUpdateTimestamp', type: 'uint40' },
        { name: 'id', type: 'uint16' },
        { name: 'aTokenAddress', type: 'address' },
        { name: 'stableDebtTokenAddress', type: 'address' },
        { name: 'variableDebtTokenAddress', type: 'address' },
        { name: 'interestRateStrategyAddress', type: 'address' },
        { name: 'accruedToTreasury', type: 'uint128' },
        { name: 'unbacked', type: 'uint128' },
        { name: 'isolationModeTotalDebt', type: 'uint128' },
      ],
    }],
  },
  {
    name: 'getReservesList',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
] as const

// ERC-20 symbol ABI
const ERC20_ABI = [
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

// ─── Types ───
interface YieldOpportunity {
  protocol: string
  asset: string
  supplyApy: number
  borrowApy: number
  tvlUsd: number | null
  source: 'on-chain' | 'defillama' | 'morpho-api'
}

// ─── Ray to Percentage (Aave V3 uses 1e27 precision) ───
function rayToPercent(ray: bigint): number {
  // ray is annual rate in 1e27 → divide by 1e25 to get percentage
  return Number(ray) / 1e25
}

// ─── 1. DefiLlama Yields API ───
async function fetchDefiLlamaYields(): Promise<YieldOpportunity[]> {
  console.log('\n📡 Fetching DefiLlama yields...')

  const res = await fetch('https://yields.llama.fi/pools')
  const data = await res.json() as { data: any[] }

  // Filter for Hyperliquid chain lending pools
  const hyperPools = data.data.filter((p: any) =>
    (p.chain === 'Hyperliquid' || p.chain === 'HyperEVM') &&
    p.category === 'Lending'
  )

  console.log(`   Found ${hyperPools.length} lending pools on Hyperliquid`)

  return hyperPools.map((p: any) => ({
    protocol: p.project,
    asset: p.symbol,
    supplyApy: p.apy ?? p.apyBase ?? 0,
    borrowApy: p.apyBaseBorrow ?? 0,
    tvlUsd: p.tvlUsd ?? null,
    source: 'defillama' as const,
  }))
}

// ─── 2. On-Chain Reads (Aave V3 Forks) ───
async function fetchAaveV3Yields(
  protocolName: string,
  poolAddress: `0x${string}`
): Promise<YieldOpportunity[]> {
  console.log(`\n🔗 Reading ${protocolName} on-chain...`)

  const results: YieldOpportunity[] = []

  try {
    // Get all reserve addresses
    const reserves = await client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'getReservesList',
    })

    console.log(`   Found ${reserves.length} reserves`)

    for (const asset of reserves) {
      try {
        // Get reserve data
        const data = await client.readContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'getReserveData',
          args: [asset],
        })

        // Get token symbol
        let symbol = asset.slice(0, 10) + '...'
        try {
          symbol = await client.readContract({
            address: asset,
            abi: ERC20_ABI,
            functionName: 'symbol',
          })
        } catch { /* some tokens may not have symbol() */ }

        const supplyApy = rayToPercent(BigInt(data.currentLiquidityRate))
        const borrowApy = rayToPercent(BigInt(data.currentVariableBorrowRate))

        results.push({
          protocol: protocolName,
          asset: symbol,
          supplyApy,
          borrowApy,
          tvlUsd: null,
          source: 'on-chain',
        })
      } catch (e) {
        // Skip individual reserve errors
      }
    }
  } catch (e: any) {
    console.log(`   ⚠️  Error reading ${protocolName}: ${e.message?.slice(0, 80)}`)
  }

  return results
}

// ─── 3. Morpho GraphQL API (Felix Vanilla Markets) ───
async function fetchFelixYields(): Promise<YieldOpportunity[]> {
  console.log('\n📊 Fetching Felix (Morpho) markets...')

  const query = `{
    markets(where: { chainId_in: [999] }, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
      items {
        uniqueKey
        loanAsset { symbol }
        collateralAsset { symbol }
        state {
          supplyApy
          borrowApy
          supplyAssetsUsd
          borrowAssetsUsd
          utilization
        }
      }
    }
  }`

  try {
    const res = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    const data = await res.json() as any
    const markets = data?.data?.markets?.items ?? []

    console.log(`   Found ${markets.length} Felix/Morpho markets`)

    return markets.map((m: any) => ({
      protocol: 'Felix (Morpho)',
      asset: `${m.loanAsset?.symbol ?? '?'} / ${m.collateralAsset?.symbol ?? '?'}`,
      supplyApy: (m.state?.supplyApy ?? 0) * 100,
      borrowApy: (m.state?.borrowApy ?? 0) * 100,
      tvlUsd: m.state?.supplyAssetsUsd ?? null,
      source: 'morpho-api' as const,
    }))
  } catch (e: any) {
    console.log(`   ⚠️  Error fetching Felix: ${e.message?.slice(0, 80)}`)
    return []
  }
}

// ─── Rank by Supply APY ───
function rankOpportunities(ops: YieldOpportunity[]): YieldOpportunity[] {
  return ops
    .filter(o => o.supplyApy > 0.01) // skip dust
    .sort((a, b) => b.supplyApy - a.supplyApy)
}

// ─── Pretty Print ───
function printTable(ops: YieldOpportunity[]) {
  console.log('\n' + '═'.repeat(85))
  console.log('  YIELD OPPORTUNITIES — HyperEVM Lending Protocols')
  console.log('═'.repeat(85))
  console.log(
    '  ' +
    'Protocol'.padEnd(20) +
    'Asset'.padEnd(18) +
    'Supply APY'.padEnd(14) +
    'Borrow APY'.padEnd(14) +
    'TVL'.padEnd(14) +
    'Source'
  )
  console.log('─'.repeat(85))

  for (const o of ops) {
    const tvl = o.tvlUsd
      ? `$${(o.tvlUsd / 1e6).toFixed(1)}M`
      : '—'

    console.log(
      '  ' +
      o.protocol.padEnd(20) +
      o.asset.slice(0, 16).padEnd(18) +
      `${o.supplyApy.toFixed(2)}%`.padEnd(14) +
      `${o.borrowApy.toFixed(2)}%`.padEnd(14) +
      tvl.padEnd(14) +
      o.source
    )
  }

  console.log('─'.repeat(85))
  console.log(`  Total: ${ops.length} opportunities | ${new Date().toLocaleString()}`)
  console.log('═'.repeat(85))
}

// ─── Main ───
async function main() {
  console.log('🤖 Yield Agent — HyperEVM Monitor')
  console.log('   Scanning lending protocols...')

  // Fetch from all sources in parallel
  const [defiLlama, hyperLend, hypurrFi, felix] = await Promise.all([
    fetchDefiLlamaYields(),
    fetchAaveV3Yields(PROTOCOLS.hyperLend.name, PROTOCOLS.hyperLend.pool),
    fetchAaveV3Yields(PROTOCOLS.hypurrFi.name, PROTOCOLS.hypurrFi.pool),
    fetchFelixYields(),
  ])

  // Combine all results
  const all = [...hyperLend, ...hypurrFi, ...felix]

  // If on-chain data is sparse, backfill with DefiLlama
  if (all.length < 5 && defiLlama.length > 0) {
    console.log('\n   Adding DefiLlama data as supplement...')
    all.push(...defiLlama)
  }

  // Also always show DefiLlama separately for comparison
  const ranked = rankOpportunities(all)

  printTable(ranked)

  // Highlight the best
  if (ranked.length > 0) {
    const best = ranked[0]
    console.log(`\n  🏆 Best yield: ${best.protocol} — ${best.asset} at ${best.supplyApy.toFixed(2)}% APY`)
  }

  // Also show DefiLlama data if we have on-chain data
  if (all.length >= 5 && defiLlama.length > 0) {
    console.log('\n\n  📋 DefiLlama comparison data:')
    const rankedDL = rankOpportunities(defiLlama)
    printTable(rankedDL)
  }
}

main().catch(console.error)
