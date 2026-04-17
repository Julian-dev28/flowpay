// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IPaymentRouter
/// @notice External surface for PaymentRouter. See PaymentRouter.sol for the
///         EIP-712 type and storage layout.
interface IPaymentRouter {
    event Settled(
        bytes32 indexed orderHash,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 nonce
    );

    error InvalidSignature();
    error SignatureExpired();
    error AlreadyUsedNonce();

    function settle(
        address payer,
        address merchant,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
