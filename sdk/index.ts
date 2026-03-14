/**
 * Louis SDK — Integrate Louis Vault into any frontend or protocol
 *
 * Usage:
 *   import { LouisSDK } from '@louis/sdk'
 *
 *   const louis = new LouisSDK({ publicClient, walletClient })
 *   const tvl = await louis.totalAssets()
 *   await louis.deposit('100', userAddress)
 *   await louis.withdraw('50', userAddress)
 */

import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  defineChain,
  type PublicClient,
  type WalletClient,
  type Address,
} from 'viem'

// ═══════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════

export const HYPER_EVM = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
})

export const ADDRESSES = {
  VAULT: '0xCA94b6120853c77C6456Fb24c8618bEa8961Ab75' as Address,
  USDHL: '0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5' as Address,
  USDC: '0xb88339CB7199b77E23DB6E890353E22632Ba630f' as Address,
  USDT: '0xB8CE59fc3717ada4C02eadf9682A9e934F625Ebb' as Address,
  ROUTER: '0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A' as Address,
} as const

// ═══════════════════════════════════════════════════════════
//  ABIs
// ═══════════════════════════════════════════════════════════

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const

const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { name: 'redeem', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'convertToShares', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'asset', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'protocolCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'protocolBalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'activeIndex', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'maxWithdraw', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'maxRedeem', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'previewDeposit', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'previewWithdraw', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

const ROUTER_ABI = [
  { name: 'getAmountsOut', type: 'function', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
  { name: 'swapExactTokensForTokens', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
] as const

// ═══════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════

export interface LouisConfig {
  /** Viem public client (for reads) — if not provided, creates a default one */
  publicClient?: PublicClient
  /** Viem wallet client (for writes) — required for deposit/withdraw */
  walletClient?: WalletClient
}

export interface VaultState {
  totalAssets: string
  totalAssetsRaw: bigint
  protocolCount: number
  activeIndex: number
  protocols: { index: number; balance: string; balanceRaw: bigint }[]
}

export interface UserPosition {
  shares: string
  sharesRaw: bigint
  assets: string
  assetsRaw: bigint
  maxWithdraw: string
  maxWithdrawRaw: bigint
}

export interface SwapQuote {
  inputToken: Address
  inputAmount: string
  expectedOutput: string
  expectedOutputRaw: bigint
  minimumOutput: string
  minimumOutputRaw: bigint
  priceImpact: number
}

// ═══════════════════════════════════════════════════════════
//  SDK
// ═══════════════════════════════════════════════════════════

export class LouisSDK {
  public readonly publicClient: PublicClient
  private walletClient?: WalletClient

  constructor(config: LouisConfig = {}) {
    this.publicClient = config.publicClient ?? createPublicClient({
      chain: HYPER_EVM,
      transport: http(),
    })
    this.walletClient = config.walletClient
  }

  // ─── Read Functions ───────────────────────────────────

  /** Get total assets in the vault (formatted as string, e.g. "1234.56") */
  async totalAssets(): Promise<string> {
    const raw = await this.publicClient.readContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'totalAssets',
    })
    return formatUnits(raw, 6)
  }

  /** Get full vault state including protocol allocations */
  async getVaultState(): Promise<VaultState> {
    const [totalRaw, countRaw, activeRaw] = await Promise.all([
      this.publicClient.readContract({ address: ADDRESSES.VAULT, abi: VAULT_ABI, functionName: 'totalAssets' }),
      this.publicClient.readContract({ address: ADDRESSES.VAULT, abi: VAULT_ABI, functionName: 'protocolCount' }),
      this.publicClient.readContract({ address: ADDRESSES.VAULT, abi: VAULT_ABI, functionName: 'activeIndex' }),
    ])

    const count = Number(countRaw)
    const protocols = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const balRaw = await this.publicClient.readContract({
          address: ADDRESSES.VAULT,
          abi: VAULT_ABI,
          functionName: 'protocolBalance',
          args: [BigInt(i)],
        })
        return { index: i, balance: formatUnits(balRaw, 6), balanceRaw: balRaw }
      })
    )

    return {
      totalAssets: formatUnits(totalRaw, 6),
      totalAssetsRaw: totalRaw,
      protocolCount: count,
      activeIndex: Number(activeRaw),
      protocols,
    }
  }

  /** Get a user's position in the vault */
  async getUserPosition(user: Address): Promise<UserPosition> {
    const [sharesRaw, maxWithdrawRaw] = await Promise.all([
      this.publicClient.readContract({ address: ADDRESSES.VAULT, abi: VAULT_ABI, functionName: 'balanceOf', args: [user] }),
      this.publicClient.readContract({ address: ADDRESSES.VAULT, abi: VAULT_ABI, functionName: 'maxWithdraw', args: [user] }),
    ])

    let assetsRaw = 0n
    if (sharesRaw > 0n) {
      assetsRaw = await this.publicClient.readContract({
        address: ADDRESSES.VAULT,
        abi: VAULT_ABI,
        functionName: 'convertToAssets',
        args: [sharesRaw],
      })
    }

    return {
      shares: formatUnits(sharesRaw, 6),
      sharesRaw,
      assets: formatUnits(assetsRaw, 6),
      assetsRaw,
      maxWithdraw: formatUnits(maxWithdrawRaw, 6),
      maxWithdrawRaw,
    }
  }

  /** Get a swap quote for depositing non-USDHL tokens */
  async getSwapQuote(inputToken: Address, amount: string, slippageBps = 50): Promise<SwapQuote> {
    const amountIn = parseUnits(amount, 6)
    const amounts = await this.publicClient.readContract({
      address: ADDRESSES.ROUTER,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountIn, [inputToken, ADDRESSES.USDHL]],
    })

    const expectedOut = amounts[1]
    const minOut = expectedOut * BigInt(10000 - slippageBps) / 10000n
    const impact = Number(amountIn - expectedOut) / Number(amountIn) * 100

    return {
      inputToken,
      inputAmount: amount,
      expectedOutput: formatUnits(expectedOut, 6),
      expectedOutputRaw: expectedOut,
      minimumOutput: formatUnits(minOut, 6),
      minimumOutputRaw: minOut,
      priceImpact: Math.abs(impact),
    }
  }

  /** Get user's balance of any supported token */
  async getTokenBalance(token: Address, user: Address): Promise<string> {
    const raw = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [user],
    })
    return formatUnits(raw, 6)
  }

  // ─── Write Functions ──────────────────────────────────

  private ensureWallet(): WalletClient {
    if (!this.walletClient) throw new Error('LouisSDK: walletClient required for write operations')
    return this.walletClient
  }

  /** Approve a token for spending by the vault or router */
  async approve(token: Address, spender: Address, amount: string): Promise<`0x${string}`> {
    const wallet = this.ensureWallet()
    const amountRaw = parseUnits(amount, 6)

    return wallet.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amountRaw],
      chain: HYPER_EVM,
      account: wallet.account!,
    })
  }

  /** Deposit USDHL directly into the vault */
  async deposit(amount: string, receiver: Address): Promise<`0x${string}`> {
    const wallet = this.ensureWallet()
    const amountRaw = parseUnits(amount, 6)

    return wallet.writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [amountRaw, receiver],
      chain: HYPER_EVM,
      account: wallet.account!,
    })
  }

  /** Withdraw underlying assets from the vault */
  async withdraw(amount: string, receiver: Address, owner: Address): Promise<`0x${string}`> {
    const wallet = this.ensureWallet()
    const amountRaw = parseUnits(amount, 6)

    return wallet.writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [amountRaw, receiver, owner],
      chain: HYPER_EVM,
      account: wallet.account!,
    })
  }

  /** Redeem vault shares for underlying assets */
  async redeem(shares: string, receiver: Address, owner: Address): Promise<`0x${string}`> {
    const wallet = this.ensureWallet()
    const sharesRaw = parseUnits(shares, 6)

    return wallet.writeContract({
      address: ADDRESSES.VAULT,
      abi: VAULT_ABI,
      functionName: 'redeem',
      args: [sharesRaw, receiver, owner],
      chain: HYPER_EVM,
      account: wallet.account!,
    })
  }

  /** Swap a token to USDHL via HyperSwap */
  async swap(inputToken: Address, amount: string, minOut: bigint, receiver: Address): Promise<`0x${string}`> {
    const wallet = this.ensureWallet()
    const amountRaw = parseUnits(amount, 6)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300) // 5 min

    return wallet.writeContract({
      address: ADDRESSES.ROUTER,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [amountRaw, minOut, [inputToken, ADDRESSES.USDHL], receiver, deadline],
      chain: HYPER_EVM,
      account: wallet.account!,
    })
  }

  /**
   * Full zap: swap non-USDHL token → USDHL → deposit into vault
   * Returns an array of tx hashes for each step
   */
  async zapDeposit(
    inputToken: Address,
    amount: string,
    receiver: Address,
    slippageBps = 50,
  ): Promise<{ step: string; hash: `0x${string}` }[]> {
    const results: { step: string; hash: `0x${string}` }[] = []

    // 1. Approve input token for router
    const approveRouterHash = await this.approve(inputToken, ADDRESSES.ROUTER, amount)
    results.push({ step: 'approve-router', hash: approveRouterHash })
    await this.publicClient.waitForTransactionReceipt({ hash: approveRouterHash })

    // 2. Swap to USDHL
    const quote = await this.getSwapQuote(inputToken, amount, slippageBps)
    const swapHash = await this.swap(inputToken, amount, quote.minimumOutputRaw, receiver)
    results.push({ step: 'swap', hash: swapHash })
    await this.publicClient.waitForTransactionReceipt({ hash: swapHash })

    // 3. Check USDHL balance received
    const usdhlBalance = await this.publicClient.readContract({
      address: ADDRESSES.USDHL,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [receiver],
    })
    const usdhlAmount = formatUnits(usdhlBalance, 6)

    // 4. Approve USDHL for vault
    const approveVaultHash = await this.approve(ADDRESSES.USDHL, ADDRESSES.VAULT, usdhlAmount)
    results.push({ step: 'approve-vault', hash: approveVaultHash })
    await this.publicClient.waitForTransactionReceipt({ hash: approveVaultHash })

    // 5. Deposit into vault
    const depositHash = await this.deposit(usdhlAmount, receiver)
    results.push({ step: 'deposit', hash: depositHash })

    return results
  }
}

export default LouisSDK
