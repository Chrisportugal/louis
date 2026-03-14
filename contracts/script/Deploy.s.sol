// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/YieldVault.sol";

/// @title  DeployVault — Step 1: Deploy only
/// @dev    Run: forge script contracts/script/Deploy.s.sol --rpc-url https://rpc.hyperliquid.xyz/evm --broadcast --legacy --with-gas-price 1000000000
contract DeployVault is Script {
    address constant USDHL = 0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5;
    address constant FEE_RECIPIENT = 0xda499a791DF2C0d1b6bf0f5eC872320Dd66B072f;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("Deployer:", deployer);
        console.log("Deploying Louis YieldVault for USDHL on HyperEVM...");

        vm.startBroadcast(pk);

        YieldVault vault = new YieldVault(
            IERC20(USDHL),
            "Louis USD",
            "louisUSD",
            deployer,
            deployer,
            FEE_RECIPIENT
        );

        console.log("YieldVault deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
