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

    event Settled(address indexed merchant, address indexed token, uint256 amount, uint256 nonce);

    error InvalidSignature();
    error ExpiredDeadline();
    error Reentrancy();
    error SignatureExpired();
    error AlreadyUsedNonce();

    function settle(address merchant, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes memory signature) external;
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
