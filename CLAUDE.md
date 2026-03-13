# Louis — HyperEVM Yield Vault

## What this is
Louis is an AI-powered yield allocation vault on HyperEVM that deploys capital
to the best risk-adjusted lending opportunities across protocols.

## Architecture
- **Monitor**: Fetches live APY data from lending protocols (on-chain + APIs)
- **Ranker**: Compares risk-adjusted yields across all protocols and markets
- **Executor** (future): Deposits/withdraws via Viem transactions
- **AI Brain** (future): Autonomous rebalancing decisions

## Target Protocols (HyperEVM)
1. **HyperLend** — Aave V3 fork, ~$373M TVL
   - Pool: `0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b`
2. **HypurrFi** — Aave V3 fork, ~$300M TVL
   - Pool: `0xceCcE0EB9DD2Ef7996e01e25DD70e461F918A14b`
3. **Felix Vanilla Markets** — Morpho Blue fork, ~$401M TVL
   - Morpho: `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`
4. **Hyperbeat** — Morpho frontend + validator

## Phase 2 (delta-neutral)
- Harmonix vaults (haUSDC, haUSDT, haUSDH)
- Resolv
- Other delta-neutral protocols

## Tech Stack
- TypeScript + Viem for on-chain reads
- DefiLlama API for cross-protocol yield data
- Morpho GraphQL API for Felix markets
- HyperEVM RPC: `https://rpc.hyperliquid.xyz/evm` (chain ID 999)

## Conventions
- All APYs displayed as percentages (e.g., 5.23%)
- TVL in USD
- Risk score: 1 (safest) to 10 (riskiest)
- Run with: `npx tsx src/monitor.ts`
