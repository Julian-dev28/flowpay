// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPaymentRouter {
    struct PaymentOrder {
        address payer;
        address merchant;
        address token;
        uint256 amount;
        bytes32 nonce;
        uint256 deadline;
    }

    event Settled(
        bytes32 indexed orderHash,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        bytes32 nonce
    );

    error InvalidSignature();
    error ExpiredDeadline();
    error Reentrancy();

    function execute(PaymentOrder calldata order, bytes calldata signature) external;
}
