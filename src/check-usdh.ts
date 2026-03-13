import { createPublicClient, http, formatUnits, formatEther } from 'viem'

const WALLET = '0xEe152Ac16E3b50e51f229E867451Ebc3e5652E59' as const
const USDH = '0x111111a1a0667d36bd57c0a9f569b98057111111' as `0x${string}`

const client = createPublicClient({
  chain: {
    id: 999,
    name: 'HyperEVM',
    nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  },
  transport: http(),
})

const ERC20 = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const

async function main() {
  const hype = await client.getBalance({ address: WALLET })
  console.log(`HYPE:  ${formatEther(hype)}`)

  const dec = await client.readContract({ address: USDH, abi: ERC20, functionName: 'decimals' })
  const bal = await client.readContract({ address: USDH, abi: ERC20, functionName: 'balanceOf', args: [WALLET] })
  console.log(`USDH:  ${formatUnits(bal, dec)}`)
}

main().catch(console.error)
