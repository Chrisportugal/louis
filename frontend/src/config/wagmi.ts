import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'

export const hyperEVM = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.hyperliquid.xyz/evm'] },
  },
  blockExplorers: {
    default: { name: 'HyperScan', url: 'https://hyperscan.xyz' },
  },
})

export const config = createConfig({
  chains: [hyperEVM],
  connectors: [injected()],
  transports: {
    [hyperEVM.id]: http(),
  },
})
