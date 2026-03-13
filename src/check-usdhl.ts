import { createPublicClient, http, formatUnits, formatEther } from 'viem'

const WALLET = '0xEe152Ac16E3b50e51f229E867451Ebc3e5652E59' as const
const USDHL = '0xb50a96253abdf803d85efcdce07ad8becbc52bd5' as `0x${string}`

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
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const

async function main() {
  const hype = await client.getBalance({ address: WALLET })
  console.log(`HYPE:   ${formatEther(hype)}`)

  const sym = await client.readContract({ address: USDHL, abi: ERC20, functionName: 'symbol' })
  const dec = await client.readContract({ address: USDHL, abi: ERC20, functionName: 'decimals' })
  const bal = await client.readContract({ address: USDHL, abi: ERC20, functionName: 'balanceOf', args: [WALLET] })
  console.log(`${sym}:  ${formatUnits(bal, dec)}  (${dec} decimals)`)
}

main().catch(console.error)
