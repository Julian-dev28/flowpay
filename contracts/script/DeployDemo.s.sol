// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Local demo deploy: anvil only. Deploys PaymentRouter + MockUSDC,
///         mints USDC to the demo payer, and approves the router.
///
/// Usage:
///   anvil &
///   forge script script/DeployDemo.s.sol \
///     --rpc-url http://localhost:8545 \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
///     --broadcast
contract DeployDemo is Script {
    // anvil default account #1
    address constant DEMO_PAYER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 constant DEMO_PAYER_PK =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    function run() external {
        // Deployer = account #0
        vm.startBroadcast();
        PaymentRouter router = new PaymentRouter();
        MockUSDC usdc = new MockUSDC();
        usdc.mint(DEMO_PAYER, 1_000_000_000_000); // 1,000,000 USDC (6 decimals)
        vm.stopBroadcast();

        // Payer approves the router from their own EOA
        vm.startBroadcast(DEMO_PAYER_PK);
        usdc.approve(address(router), type(uint256).max);
        vm.stopBroadcast();

        console2.log("PaymentRouter:", address(router));
        console2.log("MockUSDC:     ", address(usdc));
        console2.log("Demo payer:   ", DEMO_PAYER);
    }
}
