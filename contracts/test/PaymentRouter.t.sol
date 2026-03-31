// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

contract PaymentRouterTest is Test {
    PaymentRouter public router;
    address public owner;
    address public pauser;
    address public merchant;
    uint256 public merchantPk;

    address public constant USDC = address(0x1); // placeholder, checksum avoid
    bytes32 public constant PAYMENT_ORDER_TYPEHASH = keccak256(
        "PaymentOrder(address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        owner = address(this);
        pauser = address(0x123);
        (merchant, merchantPk) = makeAddrAndKey("merchant");

        router = new PaymentRouter();
        // Don't grant to owner, only to pauser
        router.grantRole(router.PAUSER_ROLE(), pauser);
    }

    function test_SettleWithValidSignature() public {
        // Build EIP-712 typed data
        uint256 amount = 100e6; // USDC 6 decimals
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 domainSeparator = router.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                merchant,
                USDC, // placeholder token
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Expect settle to emit Settled event
        vm.expectEmit(true, true, true, true);
        emit PaymentRouter.Settled(merchant, USDC, amount, nonce);

        router.settle(merchant, USDC, amount, nonce, deadline, signature);
    }

    function test_RevertWhen_SignatureExpired() public {
        uint256 amount = 100e6;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp - 1; // expired

        bytes32 domainSeparator = router.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                merchant,
                USDC,
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(PaymentRouter.SignatureExpired.selector);
        router.settle(merchant, USDC, amount, nonce, deadline, signature);
    }

    function test_RevertWhen_InvalidSignature() public {
        uint256 amount = 100e6;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        // Use wrong signer
        uint256 wrongPk = 0x456;
        address wrongSigner = vm.addr(wrongPk);

        bytes32 domainSeparator = router.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                merchant,
                USDC,
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(PaymentRouter.InvalidSignature.selector);
        router.settle(merchant, USDC, amount, nonce, deadline, signature);
    }

    function test_PauseByPauser() public {
        vm.prank(pauser);
        router.pause();
        assertTrue(router.paused());
    }

    function test_RevertWhen_NonPauserTriesPause() public {
        vm.expectRevert();
        router.pause();
    }
}
