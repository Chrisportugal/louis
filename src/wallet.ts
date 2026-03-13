/**
 * Wallet Scanner — Check balances on HyperEVM
 *
 * Run: npx tsx src/wallet.ts
 */

import { createPublicClient, http, formatUnits, formatEther } from 'viem'

const WALLET = '0xEe152Ac16E3b50e51f229E867451Ebc3e5652E59' as const

const client = createPublicClient({
  chain: {
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  },
  transport: http(),
})

// Common HyperEVM tokens to check
const TOKENS: { name: string; address: `0x${string}`; decimals: number }[] = [
  { name: 'USDC',    address: '0x6A7436775c0d0B70cfF4c5365404ec37c9d9aF4b', decimals: 6 },
  { name: 'USDH',    address: '0xbBbBBBBbbBBBbbbBbbBbbBBbBB0BB000000000000', decimals: 18 },
  { name: 'USD₮0',   address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625EB9', decimals: 6 },
  { name: 'WHYPE',   address: '0x5555555555555555555555555555555555555555', decimals: 18 },
  { name: 'wstHYPE', address: '0x94e8396e0869c9F2200760aF0621aFd240E1CF38', decimals: 18 },
  { name: 'kHYPE',   address: '0x6e5dCb5f7853a6739B5A1795BA22518dc8FbBD6f', decimals: 18 },
  { name: 'USDe',    address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', decimals: 18 },
  { name: 'feUSD',   address: '0x02c6a2fa58cc01a18b8d9e00ea48d65e4df26c70', decimals: 18 },
  { name: 'UBTC',    address: '0xD7D7D7D7D7D7D7D7D7D7D7D7D7D7D7D7D7D7D7D7', decimals: 8 },
  { name: 'UETH',    address: '0xcc7Ff230365bD730eE4B352cC2492CEdAC49383e', decimals: 18 },
]

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

async function main() {
  console.log('🔍 Wallet Scanner — HyperEVM')
  console.log(`   Address: ${WALLET}\n`)

  // Native HYPE balance
  const hypeBalance = await client.getBalance({ address: WALLET })
  console.log(`   HYPE (native):  ${formatEther(hypeBalance)}`)

  // ERC-20 balances
  for (const token of TOKENS) {
    try {
      const balance = await client.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [WALLET],
      })
      const formatted = formatUnits(balance, token.decimals)
      if (Number(formatted) > 0.0001) {
        console.log(`   ${token.name.padEnd(12)}  ${formatted}`)
      }
    } catch {
      // Token may not exist at this address
    }
  }

  console.log('')
}

main().catch(console.error)
