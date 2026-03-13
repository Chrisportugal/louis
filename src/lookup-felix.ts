/**
 * Lookup Felix (MetaMorpho) vault addresses on HyperEVM
 * Run: npx tsx src/lookup-felix.ts
 */

async function main() {
  const query = `{
    vaults(where: { chainId_in: [999] }, orderBy: TotalAssetsUsd, orderDirection: Desc) {
      items {
        address
        name
        symbol
        asset { symbol address decimals }
        state {
          totalAssetsUsd
          apy
          netApy
          totalAssets
        }
      }
    }
  }`

  const res = await fetch('https://api.morpho.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  const data = await res.json() as any
  const vaults = data?.data?.vaults?.items ?? []

  console.log(`Found ${vaults.length} Felix/MetaMorpho vaults on HyperEVM\n`)

  for (const v of vaults) {
    const apy = ((v.state?.apy ?? 0) * 100).toFixed(2)
    const netApy = ((v.state?.netApy ?? 0) * 100).toFixed(2)
    const tvl = v.state?.totalAssetsUsd
      ? `$${(v.state.totalAssetsUsd / 1e6).toFixed(2)}M`
      : '—'

    console.log(`${v.name}`)
    console.log(`  Address:  ${v.address}`)
    console.log(`  Symbol:   ${v.symbol}`)
    console.log(`  Asset:    ${v.asset?.symbol} (${v.asset?.address})`)
    console.log(`  APY:      ${apy}% (net: ${netApy}%)`)
    console.log(`  TVL:      ${tvl}`)
    console.log()
  }
}

main().catch(console.error)
