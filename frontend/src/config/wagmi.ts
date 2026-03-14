import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { injected, walletConnect } from 'wagmi/connectors'

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
  connectors: [
    injected(),
    walletConnect({
      projectId: 'b3c30124964e3738c82e7bfad2e1eec7',
      metadata: {
        name: 'Louis',
        description: 'AI Yield Agent on HyperEVM',
        url: 'https://louisxyz.vercel.app',
        icons: ['https://louisxyz.vercel.app/favicon.ico'],
      },
      showQrModal: true,
    }),
  ],
  transports: {
    [hyperEVM.id]: http(),
  },
})
