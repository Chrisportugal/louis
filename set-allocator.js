import { createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const OWNER_KEY = process.argv[2]
if (!OWNER_KEY) {
  console.log('Usage: node set-allocator.js 0xYOUR_OWNER_PRIVATE_KEY')
  process.exit(1)
}

const hyperEVM = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
})

const account = privateKeyToAccount(OWNER_KEY)
const client = createWalletClient({ account, chain: hyperEVM, transport: http() })

const VAULT = '0x6F07C0D9A754f420697a43336E72ad0bfe78500b'
const NEW_ALLOCATOR = '0x9611892830389192e107241d7264a93a7687021A'

console.log('Setting allocator to', NEW_ALLOCATOR)
console.log('From owner:', account.address)

try {
  const hash = await client.sendTransaction({
    to: VAULT,
    data: '0xb7165058000000000000000000000000' + NEW_ALLOCATOR.slice(2).toLowerCase(),
    gas: 100000n,
  })
  console.log('✅ TX sent:', hash)
} catch (e) {
  console.log('❌ Error:', e.shortMessage || e.message)
}
