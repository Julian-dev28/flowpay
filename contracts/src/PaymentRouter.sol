// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "openzeppelin-contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "openzeppelin-contracts/access/AccessControl.sol";
import {Pausable} from "openzeppelin-contracts/utils/Pausable.sol";
import {SafeERC20, IERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";

/// @title PaymentRouter
/// @notice EIP-712 signed payment intents. A payer pre-approves the router for
///         their token, signs a PaymentOrder, and any relayer can call settle()
///         to push the funds straight to the merchant. The router never holds
///         funds, so there's nothing to drain.
contract PaymentRouter is IPaymentRouter, EIP712, ReentrancyGuard, AccessControl, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    string private constant NAME = "PaymentRouter";
    string private constant VERSION = "1";

    bytes32 public constant PAYMENT_ORDER_TYPEHASH = keccak256(
        "PaymentOrder(address payer,address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    /// @dev Replay protection is scoped to the (payer, nonce) pair so different
    ///      payers can pick the same nonce without colliding.
    mapping(address payer => mapping(uint256 nonce => bool used)) public usedNonces;

    constructor() EIP712(NAME, VERSION) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function settle(
        address payer,
        address merchant,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (usedNonces[payer][nonce]) revert AlreadyUsedNonce();

        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                payer,
                merchant,
                token,
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != payer) revert InvalidSignature();

        usedNonces[payer][nonce] = true;

        IERC20(token).safeTransferFrom(payer, merchant, amount);

        emit Settled(structHash, payer, merchant, token, amount, nonce);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
