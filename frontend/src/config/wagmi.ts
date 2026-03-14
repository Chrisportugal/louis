import { http, createConfig } from 'wagmi'
import { mainnet, base, arbitrum, bsc } from 'wagmi/chains'
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

const projectId = 'b3c30124964e3738c82e7bfad2e1eec7'

// Source chains users can bridge from
export const SOURCE_CHAINS = [
  { id: 999, name: 'HyperEVM' },
  { id: 1, name: 'Ethereum' },
  { id: 8453, name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
  { id: 56, name: 'BNB Chain' },
  { id: -1, name: 'Solana' },
] as const

// USDC addresses on each source chain (for Across bridge)
export const USDC_BY_CHAIN: Record<number, `0x${string}`> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',      // Ethereum
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',    // Base
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',   // Arbitrum
  56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',      // BNB Chain
}

export const config = createConfig({
  chains: [hyperEVM, mainnet, base, arbitrum, bsc],
  connectors: [
    injected(),
    walletConnect({
      projectId,
      metadata: {
        name: 'Louis',
        description: 'AI Yield Agent on HyperEVM',
        url: 'https://louisxyz.vercel.app',
        icons: ['https://louisxyz.vercel.app/favicon.ico'],
      },
      showQrModal: true,
      qrModalOptions: {
        themeMode: 'dark' as const,
      },
    }),
  ],
  transports: {
    [hyperEVM.id]: http(),
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [bsc.id]: http(),
  },
})
