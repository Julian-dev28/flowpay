// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "openzeppelin-contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "openzeppelin-contracts/access/AccessControl.sol";
import {Pausable} from "openzeppelin-contracts/utils/Pausable.sol";

contract PaymentRouter is EIP712, ReentrancyGuard, AccessControl, Pausable {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    string private constant NAME = "PaymentRouter";
    string private constant VERSION = "1";

    // Match test's type hash
    bytes32 public constant PAYMENT_ORDER_TYPEHASH = keccak256(
        "PaymentOrder(address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    mapping(address => mapping(uint256 => bool)) public usedNonces;

    event Settled(address indexed merchant, address indexed token, uint256 amount, uint256 nonce);

    error InvalidSignature();
    error SignatureExpired();
    error AlreadyUsedNonce();

    constructor() EIP712(NAME, VERSION) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // PAUSER_ROLE granted separately via grantRole
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function settle(
        address merchant,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes memory signature
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (usedNonces[merchant][nonce]) revert AlreadyUsedNonce();

        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_ORDER_TYPEHASH,
                merchant,
                token,
                amount,
                nonce,
                deadline
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(hash, signature);

        if (recovered != merchant) revert InvalidSignature();

        usedNonces[merchant][nonce] = true;
        // TODO: Pull tokens via Permit2, transfer to merchant

        emit Settled(merchant, token, amount, nonce);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
