// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/YieldVault.sol";

/// @title  SetupVault — Step 2: Register protocols on deployed vault
/// @dev    Run: VAULT=0x... forge script contracts/script/Setup.s.sol --rpc-url https://rpc.hyperliquid.xyz/evm --broadcast --legacy --with-gas-price 1000000000 --slow
contract SetupVault is Script {
    // Aave V3 Pool contracts
    address constant HYPERLEND_POOL   = 0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b;
    address constant HYPURRFI_POOL    = 0xceCcE0EB9DD2Ef7996e01e25DD70e461F918A14b;

    // aToken addresses for USDHL
    address constant HYPERLEND_AUSDHL = 0x0b936DE4370E4B2bE947C01fe0a6FB5f987c4709;
    address constant HYPURRFI_AUSDHL  = 0xFd32712A1cb152c03a62D54557fcb1dE372ABfe9;

    // Felix MetaMorpho ERC-4626 vaults for USDHL
    address constant FELIX_USDHL_FRONTIER = 0x66c71204B70aE27BE6dC3eb41F9aF5868E68fDb6;
    address constant FELIX_USDHL          = 0x9c59a9389D8f72DE2CdAf1126F36EA4790E2275e;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address vaultAddr = vm.envAddress("VAULT");
        YieldVault vault = YieldVault(vaultAddr);

        console.log("Setting up vault at:", vaultAddr);

        vm.startBroadcast(pk);

        vault.addProtocol(HYPERLEND_POOL, HYPERLEND_AUSDHL);
        console.log("Added HyperLend (Aave V3)");

        vault.addProtocol(HYPURRFI_POOL, HYPURRFI_AUSDHL);
        console.log("Added HypurrFi (Aave V3)");

        vault.addVault(FELIX_USDHL_FRONTIER);
        console.log("Added Felix USDhl Frontier (ERC-4626)");

        vault.addVault(FELIX_USDHL);
        console.log("Added Felix USDhl (ERC-4626)");

        vault.setActiveIndex(2);
        console.log("Active protocol set to Felix USDhl Frontier (index 2)");

        vm.stopBroadcast();
    }
}
