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
  encodeFunctionData,
  type Chain,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Config ───
const INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const REBALANCE_THRESHOLD = 0.5    // Only rebalance if >0.5% APY difference
const DRY_RUN = process.env.DRY_RUN === '1'

// ─── Smart Rebalancing Config ───
const MIN_CANDIDATE_AGE_MS = 24 * 60 * 60 * 1000  // Must be better for 24h before rebalance
const COST_PROJECTION_DAYS = 30                     // Project yield gain over 30 days
const HYPE_PRICE_USD = 15                           // Conservative $/HYPE for gas cost calc
const APY_HISTORY_MAX = 336                         // 7 days of 30-min readings

// ─── State File ───
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const STATE_FILE = join(__dirname, 'agent-state.json')

const VAULT = '0x6F07C0D9A754f420697a43336E72ad0bfe78500b' as Address
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

// ─── Agent State (persisted between cycles) ───

interface AgentState {
  apyHistory: Array<{ timestamp: number; apys: number[] }>  // apys[i] = APY for protocol index i
  candidate: {
    index: number
    name: string
    firstSeenAt: number  // Unix ms when first observed as best
  } | null
  lastRebalanceAt: number | null
}

const DEFAULT_STATE: AgentState = {
  apyHistory: [],
  candidate: null,
  lastRebalanceAt: null,
}

function loadState(): AgentState {
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8')
    return JSON.parse(raw) as AgentState
  } catch {
    return { ...DEFAULT_STATE, apyHistory: [] }
  }
}

function saveState(state: AgentState): void {
  const tmp = STATE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, STATE_FILE)
}

// ─── APY Averaging ───

function getAvgApys(state: AgentState, windowMs: number): number[] {
  const cutoff = Date.now() - windowMs
  const recent = state.apyHistory.filter(h => h.timestamp >= cutoff)
  if (recent.length === 0) return [0, 0, 0, 0]

  const sums = [0, 0, 0, 0]
  for (const entry of recent) {
    for (let i = 0; i < 4; i++) {
      sums[i] += entry.apys[i] ?? 0
    }
  }
  return sums.map(s => s / recent.length)
}

function getDailyAvgApys(state: AgentState): number[] {
  return getAvgApys(state, 24 * 60 * 60 * 1000) // 24h
}

function getWeeklyAvgApys(state: AgentState): number[] {
  return getAvgApys(state, 7 * 24 * 60 * 60 * 1000) // 7d
}

// ─── Gas Cost & Profit ───

async function estimateRebalanceCostUsd(
  from: number,
  to: number,
  amount: bigint,
  account: Address,
): Promise<number> {
  try {
    const data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: 'reallocate',
      args: [BigInt(from), BigInt(to), amount],
    })
    const gasEstimate = await publicClient.estimateGas({
      account,
      to: VAULT,
      data,
    })
    const gasPrice = await publicClient.getGasPrice()
    const costWei = gasEstimate * gasPrice
    const costHype = Number(costWei) / 1e18 * 1.5 // 1.5x safety margin
    return costHype * HYPE_PRICE_USD
  } catch (e: any) {
    console.log(`     ⚠️ Gas estimation failed: ${e.message?.slice(0, 80)}`)
    return 0.50 // conservative fallback
  }
}

function calculateProjectedGainUsd(apyDiff: number, totalAssets: bigint): number {
  const totalUsd = Number(formatUnits(totalAssets, 6))
  return (apyDiff / 100) * totalUsd * (COST_PROJECTION_DAYS / 365)
}

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

  // 4. Smart rebalancing with daily/weekly averaging
  const agentState = loadState()

  // Record this cycle's APYs to history
  agentState.apyHistory.push({
    timestamp: Date.now(),
    apys: PROTOCOLS.map((_, i) => apys.find(p => p.index === i)?.apy ?? 0),
  })
  // Trim to 7 days of history
  if (agentState.apyHistory.length > APY_HISTORY_MAX) {
    agentState.apyHistory = agentState.apyHistory.slice(-APY_HISTORY_MAX)
  }

  // Compute averages
  const dailyAvg = getDailyAvgApys(agentState)
  const weeklyAvg = getWeeklyAvgApys(agentState)
  const historyCount = agentState.apyHistory.length

  console.log(`\n  📡 Instant APYs:`)
  for (const p of apys) {
    console.log(`     [${p.index}] ${p.name.padEnd(25)} ${p.apy.toFixed(2)}%`)
  }

  console.log(`\n  📊 Daily Avg (24h, ${Math.min(historyCount, 48)} readings):`)
  console.log(`     ${PROTOCOLS.map((p, i) => `${p.name.split(' ')[0]} ${dailyAvg[i].toFixed(2)}%`).join('  |  ')}`)

  console.log(`  📊 Weekly Avg (7d, ${Math.min(historyCount, 336)} readings):`)
  console.log(`     ${PROTOCOLS.map((p, i) => `${p.name.split(' ')[0]} ${weeklyAvg[i].toFixed(2)}%`).join('  |  ')}`)

  // Use DAILY averages to find best (not instant — avoids chasing spikes)
  const currentIdx = state.activeIndex
  const currentDailyApy = dailyAvg[currentIdx]
  let bestDailyIdx = 0
  let bestDailyApy = dailyAvg[0]
  for (let i = 1; i < dailyAvg.length; i++) {
    if (dailyAvg[i] > bestDailyApy) {
      bestDailyApy = dailyAvg[i]
      bestDailyIdx = i
    }
  }
  const dailyDiff = bestDailyApy - currentDailyApy

  console.log(`\n  🏆 Best (daily avg): ${PROTOCOLS[bestDailyIdx].name} @ ${bestDailyApy.toFixed(2)}%`)
  console.log(`  📍 Current: ${PROTOCOLS[currentIdx].name} @ ${currentDailyApy.toFixed(2)}%`)
  console.log(`  📏 Difference: ${dailyDiff.toFixed(2)}%`)

  // Gate 1: Daily average must beat threshold
  if (dailyDiff > REBALANCE_THRESHOLD && bestDailyIdx !== currentIdx) {

    // Candidate tracking
    if (agentState.candidate && agentState.candidate.index === bestDailyIdx) {
      // Same candidate still leading
      const hoursElapsed = (Date.now() - agentState.candidate.firstSeenAt) / (60 * 60 * 1000)
      console.log(`\n  📈 ${agentState.candidate.name} has been better for ${hoursElapsed.toFixed(1)}h`)

      // Gate 2: Must be better for >24 hours
      if (Date.now() - agentState.candidate.firstSeenAt < MIN_CANDIDATE_AGE_MS) {
        const hoursRemaining = (MIN_CANDIDATE_AGE_MS - (Date.now() - agentState.candidate.firstSeenAt)) / (60 * 60 * 1000)
        console.log(`  ⏳ Waiting for 24h confirmation (${hoursRemaining.toFixed(1)}h remaining)`)
        saveState(agentState)
        return
      }

      // Gate 3: Weekly average must also confirm
      const weeklyDiff = weeklyAvg[bestDailyIdx] - weeklyAvg[currentIdx]
      if (weeklyDiff <= 0) {
        console.log(`  📉 Weekly avg doesn't confirm (${weeklyDiff.toFixed(2)}%) — waiting for weekly trend`)
        saveState(agentState)
        return
      }

      // Gate 4: Projected gain must exceed gas cost
      const projectedGain = calculateProjectedGainUsd(dailyDiff, state.totalAssets)
      const current_protocol = apys.find(p => p.index === currentIdx)!
      const gasCost = await estimateRebalanceCostUsd(
        currentIdx,
        bestDailyIdx,
        current_protocol.balance,
        wallet.account.address,
      )

      console.log(`  💰 Projected 30-day gain: $${projectedGain.toFixed(2)} | Gas cost: $${gasCost.toFixed(4)}`)

      if (projectedGain <= gasCost) {
        console.log(`  💸 Not profitable at current TVL — skipping`)
        saveState(agentState)
        return
      }

      // ALL GATES PASSED — execute rebalance
      console.log(`\n  ✅ All gates passed — rebalancing to ${PROTOCOLS[bestDailyIdx].name}`)

      if (current_protocol.balance > 0n) {
        await reallocate(wallet, currentIdx, bestDailyIdx, current_protocol.balance)
      }
      if (bestDailyIdx !== state.activeIndex) {
        await setActiveIndex(wallet, bestDailyIdx)
      }

      // Reset candidate after successful rebalance
      agentState.candidate = null
      agentState.lastRebalanceAt = Date.now()

    } else {
      // New candidate (or different protocol took the lead)
      if (agentState.candidate) {
        console.log(`\n  🔄 Previous candidate [${agentState.candidate.name}] displaced by [${PROTOCOLS[bestDailyIdx].name}]`)
      }
      agentState.candidate = {
        index: bestDailyIdx,
        name: PROTOCOLS[bestDailyIdx].name,
        firstSeenAt: Date.now(),
      }
      console.log(`  🆕 New candidate: ${PROTOCOLS[bestDailyIdx].name} is ${dailyDiff.toFixed(2)}% better — starting 24h observation`)
    }

  } else {
    // No protocol beats threshold — clear candidate
    if (agentState.candidate) {
      console.log(`\n  ↩️  ${agentState.candidate.name} no longer beats threshold — clearing candidate`)
      agentState.candidate = null
    }
    console.log(`\n  ✅ No rebalance needed (daily avg diff: ${dailyDiff.toFixed(2)}%, threshold: ${REBALANCE_THRESHOLD}%)`)
  }

  saveState(agentState)

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
  console.log(`   Time confirmation: ${MIN_CANDIDATE_AGE_MS / 3600000}h`)
  console.log(`   Cost projection: ${COST_PROJECTION_DAYS} days`)
  console.log(`   HYPE price (gas calc): $${HYPE_PRICE_USD}`)

  // Load and display existing state
  const savedState = loadState()
  console.log(`   APY history: ${savedState.apyHistory.length} readings`)
  if (savedState.candidate) {
    const ageHours = (Date.now() - savedState.candidate.firstSeenAt) / 3600000
    console.log(`   📈 Resuming candidate: ${savedState.candidate.name} (${ageHours.toFixed(1)}h observed)`)
  }
  if (savedState.lastRebalanceAt) {
    const ago = (Date.now() - savedState.lastRebalanceAt) / 3600000
    console.log(`   Last rebalance: ${ago.toFixed(1)}h ago`)
  }

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
