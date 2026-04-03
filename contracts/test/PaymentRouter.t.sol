// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PaymentRouterTest is Test {
    PaymentRouter public router;
    MockUSDC public usdc;
    address public merchant;
    uint256 public merchantPk;

    bytes32 public constant PAYMENT_ORDER_TYPEHASH = keccak256(
        "PaymentOrder(address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        (merchant, merchantPk) = makeAddrAndKey("merchant");
        router = new PaymentRouter();
        usdc = new MockUSDC();

        // Mint USDC to merchant and approve router
        usdc.mint(merchant, 1000e6);
        vm.prank(merchant);
        usdc.approve(address(router), type(uint256).max);
    }

    function test_SettleWithValidSignature() public {
        uint256 amount = 100e6;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

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

        // Should succeed without revert
        router.settle(merchant, address(usdc), amount, nonce, deadline, signature);

        // Verify nonce is marked as used
        assertTrue(router.usedNonces(merchant, nonce));
    }

    function test_RevertWhen_SignatureExpired() public {
        uint256 amount = 100e6;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp - 1;

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

        vm.expectRevert(PaymentRouter.SignatureExpired.selector);
        router.settle(merchant, address(usdc), amount, nonce, deadline, signature);
    }

    function test_RevertWhen_InvalidSignature() public {
        uint256 amount = 100e6;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 wrongPk = 0x456;

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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.settle(merchant, address(usdc), amount, nonce, deadline, signature);
    }

    function test_PauseByPauser() public {
        router.grantRole(router.PAUSER_ROLE(), address(this));
        router.pause();
        assertTrue(router.paused());
    }

    function test_RevertWhen_NonPauserTriesPause() public {
        vm.expectRevert();
        router.pause();
    }
}
