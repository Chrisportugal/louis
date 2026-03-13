// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/YieldVault.sol";

/// @title  DeployVault
/// @notice Deploy YieldVault to HyperEVM targeting USDHL
/// @dev    Run: forge script contracts/script/Deploy.s.sol --rpc-url https://rpc.hyperliquid.xyz/evm --broadcast
contract DeployVault is Script {
    // ─── HyperEVM Addresses ───
    address constant USDHL = 0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5;

    // Aave V3 Pool contracts
    address constant HYPERLEND_POOL  = 0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b;
    address constant HYPURRFI_POOL   = 0xceCcE0EB9DD2Ef7996e01e25DD70e461F918A14b;

    // aToken addresses for USDHL on each protocol
    // NOTE: These must be fetched from getReserveData(USDHL) on each pool before deployment.
    //       Use: npx tsx src/lookup-atokens.ts
    // address constant HYPERLEND_AUSDHL = 0x...; // TODO: fetch on-chain
    // address constant HYPURRFI_AUSDHL  = 0x...; // TODO: fetch on-chain

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("Deployer:", deployer);
        console.log("Deploying YieldVault for USDHL on HyperEVM...");

        vm.startBroadcast(pk);

        YieldVault vault = new YieldVault(
            IERC20(USDHL),
            "Yield USDHL",
            "yUSDHL",
            deployer,    // owner
            deployer     // allocator (initially deployer, transfer to agent later)
        );

        console.log("YieldVault deployed at:", address(vault));

        // After fetching aToken addresses, uncomment these:
        // vault.addProtocol(HYPERLEND_POOL, HYPERLEND_AUSDHL);
        // vault.addProtocol(HYPURRFI_POOL, HYPURRFI_AUSDHL);

        vm.stopBroadcast();
    }
}
