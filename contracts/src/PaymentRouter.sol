// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "openzeppelin-contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";

contract PaymentRouter is IPaymentRouter, EIP712, ReentrancyGuard {
    string private constant TOKEN_NAME = "PaymentRouter";
    string private constant VERSION = "1";

    // keccak256("PaymentOrder(address payer,address merchant,address token,uint256 amount,bytes32 nonce,uint256 deadline)")
    bytes32 public constant PAYMENT_ORDER_TYPEHASH =
        keccak256("PaymentOrder(address payer,address merchant,address token,uint256 amount,bytes32 nonce,uint256 deadline)");

    mapping(address => mapping(bytes32 => bool)) public usedNonces;

    constructor() EIP712(TOKEN_NAME, VERSION) {}

    function execute(PaymentOrder calldata order, bytes calldata signature)
        external
        nonReentrant
    {
        if (block.timestamp > order.deadline) revert ExpiredDeadline();
        if (usedNonces[order.payer][order.nonce]) revert InvalidSignature();

        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                order.payer,
                order.merchant,
                order.token,
                order.amount,
                order.nonce,
                order.deadline
            )
        );

        bytes32 hash = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(hash, signature);

        if (recovered != order.payer) revert InvalidSignature();

        usedNonces[order.payer][order.nonce] = true;

        // TODO: Implement Permit2 pull + swap via 0x + transfer to merchant
        // This is intentionally a stub for the scaffold phase.

        emit Settled(
            structHash,
            order.payer,
            order.merchant,
            order.token,
            order.amount,
            order.nonce
        );
    }
}
