// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IPermit2} from "permit2/interfaces/IPermit2.sol";

contract PaymentRouterPermit2Test is Test {
    PaymentRouter public router;
    MockUSDC public usdc;
    address public merchant;
    uint256 public merchantPk;
    address public constant PERMIT2 = address(0x1234);

    bytes32 public constant PAYMENT_ORDER_TYPEHASH = keccak256(
        "PaymentOrder(address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        (merchant, merchantPk) = makeAddrAndKey("merchant");
        router = new PaymentRouter();
        usdc = new MockUSDC();

        // Mint USDC to merchant (merchant is the signer in current design)
        usdc.mint(merchant, 1000e6);
        vm.prank(merchant);
        usdc.approve(PERMIT2, type(uint256).max);
    }

    function test_SettlePullsTokensViaPermit2() public {
        uint256 amount = 100e6;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        // Merchant signs the order
        bytes32 domainSeparator = router.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                merchant,
                address(usdc),
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Record balances before
        address anyRecipient = address(0x9999);
        uint256 merchantBalanceBefore = usdc.balanceOf(merchant);
        uint256 recipientBalanceBefore = usdc.balanceOf(anyRecipient);

        // Settle — should pull tokens from merchant and send to recipient
        router.settle(merchant, address(usdc), amount, nonce, deadline, signature);

        // This will fail in red phase because tokens aren't transferred
        assertEq(usdc.balanceOf(merchant), merchantBalanceBefore - amount);
        assertEq(usdc.balanceOf(anyRecipient), recipientBalanceBefore + amount);
    }
}
