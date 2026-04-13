# FlowPay Contracts Documentation

## Overview

`PaymentRouter.sol` — EIP-712 signed payment intents with `AccessControl`, `Pausable`, and per-`(merchant, nonce)` replay protection. Tokens are pulled via standard `IERC20.transferFrom` (the router holds them; no merchant payout step yet — see QA_REPORT.md).

**Deployed on:** not yet (no deploy script committed). Designed for Base Sepolia (84532).
**Coverage:** regenerate with `forge coverage` — do not quote stale figures.

---

## EIP-712 Signed Payments

The router uses EIP-712 typed-data signing for gasless, signed payment intents.

### Domain Separator

```
name: "PaymentRouter"
version: "1"
chainId: 84532 (Base Sepolia)
verifyingContract: <deployed_address>
```

### PaymentOrder Type

```solidity
struct PaymentOrder {
    address merchant;
    address token;
    uint256 amount;
    uint256 nonce;
    uint256 deadline;
}
```

Type hash:
```solidity
keccak256("PaymentOrder(address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)")
```

### Signing Flow

1. User signs `PaymentOrder` off-chain using EIP-712
2. Signed intent is submitted to `/pay` endpoint
3. Orchestrator enqueues to `payment.submit` queue
4. Tx-submitter calls `settle()` with signature

---

## Functions

### `settle(address merchant, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)`

Process a signed payment intent.

- ✅ Verifies EIP-712 signature (must match `merchant`)
- ✅ Checks `deadline` (reverts if expired)
- ✅ Checks `nonce` (reverts on replay)
- ✅ Pulls tokens via `IERC20.transferFrom()`
- 📢 Emits `Settled` event

**Reverts:**
- `InvalidSignature()` — signature doesn't match merchant
- `SignatureExpired()` — `block.timestamp > deadline`
- `AlreadyUsedNonce()` — nonce already used

---

### `pause()` / `unpause()`

Pause or unpause the router. Restricted to `PAUSER_ROLE`.

```solidity
function pause() external onlyRole(PAUSER_ROLE);
function unpause() external onlyRole(PAUSER_ROLE);
```

---

## Events

### `Settled(bytes32 indexed orderHash, address indexed merchant, address token, uint256 amount, uint256 nonce)`

Emitted when a payment is successfully settled.

**Indexed:** `orderHash`, `merchant`  
**Non-indexed:** `token`, `amount`, `nonce`

The indexer watches this event via viem's `watchContractEvent`.

---

## Roles

| Role | Description | Grantor |
|------|------------|---------|
| `DEFAULT_ADMIN_ROLE` | Can grant/revoke roles | Deployer (on constructor) |
| `PAUSER_ROLE` | Can pause/unpause | Admin |

---

## Security

### ✅ Nonce Replay Protection

Each `(merchant, nonce)` pair can only be used once:
```solidity
if (usedNonces[merchant][nonce]) revert AlreadyUsedNonce();
```

### ✅ Signature Expiry

Payments must be submitted before `deadline`:
```solidity
if (block.timestamp > deadline) revert SignatureExpired();
```

### ✅ Signature Verification

EIP-712 signature must recover to `merchant`:
```solidity
address recovered = ECDSA.recover(hash, signature);
if (recovered != merchant) revert InvalidSignature();
```

### ✅ Pausable

Router can be paused during emergencies:
```solidity
whenNotPaused  // on settle()
```

---

## Testing

```bash
cd contracts
forge test -vv          # Run all tests
forge coverage          # Coverage report
forge snapshot          # Gas snapshot
```

**Test Suites:**
- `PaymentRouterTest` — 5 tests (signature, expiry, pause)
- `PaymentRouterReplayTest` — 1 test (nonce replay)
- `PaymentRouterPermit2Test` — 1 test (token transfer; **misnomer** — does not use Permit2, see QA_REPORT.md C2)

**Total:** 7 tests, all passing ✅

---

## Deployment

```bash
cd contracts
forge create --rpc-url <RPC_URL> --private-key <KEY> src/PaymentRouter.sol
```

Update `PAYMENT_ROUTER_ADDRESS` in:
- `services/tx-submitter/.env`
- `services/indexer/.env`
