// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PaymentRouterTest is Test {
    PaymentRouter public router;
    MockUSDC public usdc;
    address public payer;
    uint256 public payerPk;
    address public merchant;

    bytes32 public constant PAYMENT_ORDER_TYPEHASH = keccak256(
        "PaymentOrder(address payer,address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        (payer, payerPk) = makeAddrAndKey("payer");
        merchant = makeAddr("merchant");
        router = new PaymentRouter();
        usdc = new MockUSDC();

        usdc.mint(payer, 1000e6);
        vm.prank(payer);
        usdc.approve(address(router), type(uint256).max);
    }

    function _sign(uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                payer,
                merchant,
                address(usdc),
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_SettleTransfersTokensToMerchant() public {
        uint256 amount = 100e6;
        bytes memory sig = _sign(amount, 0, block.timestamp + 1 hours);

        uint256 payerBefore = usdc.balanceOf(payer);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 routerBefore = usdc.balanceOf(address(router));

        router.settle(payer, merchant, address(usdc), amount, 0, block.timestamp + 1 hours, sig);

        assertEq(usdc.balanceOf(payer), payerBefore - amount, "payer debited");
        assertEq(usdc.balanceOf(merchant), merchantBefore + amount, "merchant credited");
        assertEq(usdc.balanceOf(address(router)), routerBefore, "router holds no funds");
        assertTrue(router.usedNonces(payer, 0));
    }

    function test_SettleEmitsSettled() public {
        uint256 amount = 50e6;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(amount, 7, deadline);

        // Don't constrain orderHash — just check the other indexed fields and data.
        vm.expectEmit(false, true, true, true, address(router));
        emit IPaymentRouter.Settled(bytes32(0), payer, merchant, address(usdc), amount, 7);
        router.settle(payer, merchant, address(usdc), amount, 7, deadline, sig);
    }

    function test_RevertWhen_SignatureExpired() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _sign(amount, 0, deadline);

        vm.expectRevert(IPaymentRouter.SignatureExpired.selector);
        router.settle(payer, merchant, address(usdc), amount, 0, deadline, sig);
    }

    function test_RevertWhen_InvalidSignature() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(amount, 0, deadline);

        // Tamper: pass a different amount than what was signed
        vm.expectRevert(IPaymentRouter.InvalidSignature.selector);
        router.settle(payer, merchant, address(usdc), amount + 1, 0, deadline, sig);
    }

    function test_RevertWhen_WrongSignerSignedOrder() public {
        (, uint256 attackerPk) = makeAddrAndKey("attacker");
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                payer,
                merchant,
                address(usdc),
                amount,
                0,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(IPaymentRouter.InvalidSignature.selector);
        router.settle(payer, merchant, address(usdc), amount, 0, deadline, sig);
    }

    function test_RevertWhen_NonceReplayed() public {
        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(amount, 0, deadline);

        router.settle(payer, merchant, address(usdc), amount, 0, deadline, sig);

        vm.expectRevert(IPaymentRouter.AlreadyUsedNonce.selector);
        router.settle(payer, merchant, address(usdc), amount, 0, deadline, sig);
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

    function test_UnpauseByPauser() public {
        router.grantRole(router.PAUSER_ROLE(), address(this));
        router.pause();
        router.unpause();
        assertFalse(router.paused());
    }

    function test_RevertWhen_PausedSettleCalled() public {
        router.grantRole(router.PAUSER_ROLE(), address(this));
        router.pause();

        uint256 amount = 100e6;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(amount, 0, deadline);

        vm.expectRevert(); // Pausable: paused — uses custom error from OZ v5
        router.settle(payer, merchant, address(usdc), amount, 0, deadline, sig);
    }
}
