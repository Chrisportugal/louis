/**
 * Louis Yield Agent — Automated Rebalancer + Fee Harvester
 *
 * This agent:
 *  1. Fetches live APYs from all 4 vault protocols
 *  2. Compares against current active protocol
 *  3. Rebalances to higher-yield protocol if >0.5% better
 *  4. Harvests fees when yield has accumulated
 *  5. Runs on a loop (default: every 30 minutes)
 *
 * Run:   PRIVATE_KEY=0x... npx tsx src/agent.ts
 * Test:  PRIVATE_KEY=0x... DRY_RUN=1 npx tsx src/agent.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  type Chain,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ─── Config ───
const INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const REBALANCE_THRESHOLD = 0.5    // Only rebalance if >0.5% APY difference
const DRY_RUN = process.env.DRY_RUN === '1'

const VAULT = '0xCA94b6120853c77C6456Fb24c8618bEa8961Ab75' as Address
const USDHL = '0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5' as Address

// Protocol info matching vault indices
const PROTOCOLS = [
  { index: 0, name: 'HyperLend',           type: 'aave',    pool: '0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b' as Address },
  { index: 1, name: 'HypurrFi',            type: 'aave',    pool: '0xceCcE0EB9DD2Ef7996e01e25DD70e461F918A14b' as Address },
  { index: 2, name: 'Felix USDhl Frontier', type: 'erc4626', vault: '0x66c71204B70aE27BE6dC3eb41F9aF5868E68fDb6' as Address },
  { index: 3, name: 'Felix USDhl',          type: 'erc4626', vault: '0x9c59a9389D8f72DE2CdAf1126F36EA4790E2275e' as Address },
] as const

// ─── Chain ───
const hyperEVM: Chain = {
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
}

// ─── Clients ───
const publicClient = createPublicClient({
  chain: hyperEVM,
  transport: http(),
})

function getWalletClient() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY env var required')
  const account = privateKeyToAccount(pk as `0x${string}`)
  return createWalletClient({
    account,
    chain: hyperEVM,
    transport: http(),
  })
}

// ─── ABIs ───
const VAULT_ABI = [
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'lastTotalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'activeIndex', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'protocolCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'protocolBalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'harvest', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'reallocate', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'uint256' }, { name: 'to', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'setActiveIndex', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'index', type: 'uint256' }], outputs: [] },
] as const

const POOL_ABI = [
  {
    name: 'getReserveData', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'configuration', type: 'uint256' },
        { name: 'liquidityIndex', type: 'uint128' },
        { name: 'currentLiquidityRate', type: 'uint128' },
        { name: 'variableBorrowIndex', type: 'uint128' },
        { name: 'currentVariableBorrowRate', type: 'uint128' },
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
] as const

const MORPHO_VAULT_ABI = [
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

// ─── Fetch APYs ───

function rayToPercent(ray: bigint): number {
  return Number(ray) / 1e25
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

async function getAaveApy(poolAddress: Address): Promise<number> {
  try {
    const data = await withTimeout(
      publicClient.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'getReserveData',
        args: [USDHL],
      }),
      10_000, // 10s timeout
      null,
    )
    if (!data) { console.log(`   ⚠️ Timeout reading Aave APY from ${poolAddress}`); return 0 }
    return rayToPercent(BigInt(data.currentLiquidityRate))
  } catch (e) {
    console.log(`   ⚠️ Failed to read Aave APY from ${poolAddress}`)
    return 0
  }
}

async function getMorphoVaultApy(vaultAddress: Address): Promise<number> {
  try {
    const query = `{
      vaults(where: { address_in: ["${vaultAddress.toLowerCase()}"], chainId_in: [999] }) {
        items { state { netApy } }
      }
    }`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const data = await res.json() as any
    const apy = data?.data?.vaults?.items?.[0]?.state?.netApy ?? 0
    return apy * 100
  } catch (e) {
    console.log(`   ⚠️ Failed to fetch Morpho APY for ${vaultAddress}`)
    return 0
  }
}

interface ProtocolApy {
  index: number
  name: string
  apy: number
  balance: bigint
}

async function fetchAllApys(): Promise<ProtocolApy[]> {
  const results: ProtocolApy[] = []

  for (const p of PROTOCOLS) {
    let apy = 0
    if (p.type === 'aave') {
      apy = await getAaveApy(p.pool)
    } else {
      apy = await getMorphoVaultApy(p.vault)
    }

    // Get balance in this protocol
    let balance = 0n
    try {
      balance = await withTimeout(
        publicClient.readContract({
          address: VAULT,
          abi: VAULT_ABI,
          functionName: 'protocolBalance',
          args: [BigInt(p.index)],
        }),
        10_000,
        0n,
      )
    } catch {}

    results.push({ index: p.index, name: p.name, apy, balance })
  }

  return results
}

// ─── Vault State ───
async function getVaultState() {
  const [totalAssets, lastTotal, activeIndex] = await Promise.all([
    publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' }),
    publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'lastTotalAssets' }),
    publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'activeIndex' }),
  ])
  return {
    totalAssets,
    lastTotal,
    activeIndex: Number(activeIndex),
    yield: totalAssets > lastTotal ? totalAssets - lastTotal : 0n,
  }
}

// ─── Execute Actions ───

async function harvest(wallet: ReturnType<typeof getWalletClient>) {
  console.log('  💰 Harvesting fees...')
  if (DRY_RUN) { console.log('     [DRY RUN] Would call harvest()'); return }

  const hash = await wallet.writeContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: 'harvest',
  })
  console.log(`     TX: ${hash}`)
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('     ✅ Harvest complete')
}

async function reallocate(
  wallet: ReturnType<typeof getWalletClient>,
  from: number,
  to: number,
  amount: bigint,
) {
  console.log(`  🔄 Reallocating ${formatUnits(amount, 6)} USDHL from [${from}] → [${to}]`)
  if (DRY_RUN) { console.log('     [DRY RUN] Would call reallocate()'); return }

  const hash = await wallet.writeContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: 'reallocate',
    args: [BigInt(from), BigInt(to), amount],
  })
  console.log(`     TX: ${hash}`)
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('     ✅ Reallocation complete')
}

async function setActiveIndex(wallet: ReturnType<typeof getWalletClient>, index: number) {
  console.log(`  📌 Setting active index to [${index}]`)
  if (DRY_RUN) { console.log('     [DRY RUN] Would call setActiveIndex()'); return }

  const hash = await wallet.writeContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: 'setActiveIndex',
    args: [BigInt(index)],
  })
  console.log(`     TX: ${hash}`)
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('     ✅ Active index updated')
}

// ─── Agent Logic ───

async function runCycle() {
  const timestamp = new Date().toLocaleString()
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  🤖 Louis Agent — Cycle @ ${timestamp}`)
  console.log('═'.repeat(60))

  // 1. Fetch APYs
  console.log('\n  📡 Fetching APYs...')
  const apys = await fetchAllApys()
  for (const p of apys) {
    const bal = formatUnits(p.balance, 6)
    console.log(`     [${p.index}] ${p.name.padEnd(25)} ${p.apy.toFixed(2)}% APY  |  ${bal} USDHL`)
  }

  // 2. Get vault state
  const state = await getVaultState()
  console.log(`\n  📊 Vault State:`)
  console.log(`     Total Assets: ${formatUnits(state.totalAssets, 6)} USDHL`)
  console.log(`     Last Snapshot: ${formatUnits(state.lastTotal, 6)} USDHL`)
  console.log(`     Pending Yield: ${formatUnits(state.yield, 6)} USDHL`)
  console.log(`     Active Index: [${state.activeIndex}] ${PROTOCOLS[state.activeIndex]?.name ?? 'Unknown'}`)

  // Skip if vault is empty
  if (state.totalAssets === 0n) {
    console.log('\n  ⏸️  Vault is empty — nothing to do')
    return
  }

  const wallet = getWalletClient()

  // 3. Harvest if yield > 1 USDHL ($1)
  if (state.yield > 1_000_000n) { // 1 USDHL = 1e6
    await harvest(wallet)
  } else {
    console.log(`\n  ⏸️  Yield too small to harvest (${formatUnits(state.yield, 6)} USDHL)`)
  }

  // 4. Find best APY protocol
  const best = apys.reduce((a, b) => a.apy > b.apy ? a : b)
  const current = apys.find(p => p.index === state.activeIndex)!
  const diff = best.apy - current.apy

  console.log(`\n  🏆 Best: ${best.name} @ ${best.apy.toFixed(2)}%`)
  console.log(`  📍 Current: ${current.name} @ ${current.apy.toFixed(2)}%`)
  console.log(`  📏 Difference: ${diff.toFixed(2)}%`)

  // 5. Rebalance if difference exceeds threshold
  if (diff > REBALANCE_THRESHOLD && best.index !== state.activeIndex) {
    console.log(`\n  🚀 Rebalancing! ${current.name} → ${best.name} (${diff.toFixed(2)}% better)`)

    // Move all funds from current to best
    if (current.balance > 0n) {
      await reallocate(wallet, current.index, best.index, current.balance)
    }

    // Update active index for new deposits
    if (best.index !== state.activeIndex) {
      await setActiveIndex(wallet, best.index)
    }
  } else {
    console.log(`\n  ✅ No rebalance needed (threshold: ${REBALANCE_THRESHOLD}%)`)
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  Next cycle in ${INTERVAL_MS / 60000} minutes`)
  console.log('─'.repeat(60))
}

// ─── Main Loop ───
async function main() {
  console.log('🤖 Louis Yield Agent — Starting')
  console.log(`   Vault: ${VAULT}`)
  console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN (no transactions)' : '🔴 LIVE'}`)
  console.log(`   Interval: ${INTERVAL_MS / 60000} minutes`)
  console.log(`   Rebalance threshold: ${REBALANCE_THRESHOLD}%`)

  // Run first cycle immediately
  await runCycle()

  // Then loop
  setInterval(async () => {
    try {
      await runCycle()
    } catch (e: any) {
      console.error(`\n  ❌ Cycle failed: ${e.message}`)
    }
  }, INTERVAL_MS)
}

main().catch(console.error)
