/**
 * Lookup aToken addresses for USDHL on HyperLend and HypurrFi
 * Run: npx tsx src/lookup-atokens.ts
 */

import { createPublicClient, http } from 'viem'

const USDHL = '0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5' as `0x${string}`

const client = createPublicClient({
  chain: {
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  },
  transport: http(),
})

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

const PROTOCOLS = [
  { name: 'HyperLend', pool: '0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b' as `0x${string}` },
  { name: 'HypurrFi', pool: '0xceCcE0EB9DD2Ef7996e01e25DD70e461F918A14b' as `0x${string}` },
]

async function main() {
  console.log(`Looking up aToken addresses for USDHL (${USDHL})...\n`)

  for (const proto of PROTOCOLS) {
    try {
      const data = await client.readContract({
        address: proto.pool,
        abi: POOL_ABI,
        functionName: 'getReserveData',
        args: [USDHL],
      })

      console.log(`${proto.name}:`)
      console.log(`  Pool:            ${proto.pool}`)
      console.log(`  aToken:          ${data.aTokenAddress}`)
      console.log(`  Supply APY:      ${(Number(data.currentLiquidityRate) / 1e25).toFixed(2)}%`)
      console.log(`  Borrow APY:      ${(Number(data.currentVariableBorrowRate) / 1e25).toFixed(2)}%`)
      console.log()
    } catch (e: any) {
      console.log(`${proto.name}: USDHL not listed (${e.message?.slice(0, 60)})`)
      console.log()
    }
  }
}

main().catch(console.error)
