# FlowPay Contracts

## Overview

`PaymentRouter.sol` is an EIP-712 signed payment relayer. A **payer**
pre-approves the router for the ERC-20 they want to spend, signs a
`PaymentOrder` off-chain, and any relayer can call `settle()` to push the
funds straight from the payer to the merchant. The router never holds funds,
so there's nothing to drain.

**Target chain:** Base Sepolia (84532) — also runs unchanged on anvil and
Base mainnet.
**Coverage:** regenerate with `forge coverage`; numbers are not pinned in
this doc to keep them honest.

---

## EIP-712

### Domain

```
name              = "PaymentRouter"
version           = "1"
chainId           = <runtime>
verifyingContract = <deployed address>
```

### PaymentOrder

```solidity
struct PaymentOrder {
    address payer;
    address merchant;
    address token;
    uint256 amount;
    uint256 nonce;
    uint256 deadline;
}
```

Type hash:

```solidity
keccak256(
  "PaymentOrder(address payer,address merchant,address token,uint256 amount,uint256 nonce,uint256 deadline)"
)
```

The off-chain builder lives in `packages/eip712/src/payment-order.ts` and
stays in lockstep with the Solidity struct.

### Signing flow

1. Payer calls `IERC20(token).approve(router, ≥ amount)` once.
2. Payer signs a `PaymentOrder` with their wallet (EIP-712).
3. The signed order is POSTed to the orchestrator's `/pay` endpoint.
4. Orchestrator enqueues the job; tx-submitter calls `settle()` from a
   relayer EOA — the payer pays no gas.

---

## Functions

### `settle(payer, merchant, token, amount, nonce, deadline, signature)`

- Verifies `block.timestamp <= deadline` (`SignatureExpired`).
- Verifies `usedNonces[payer][nonce] == false` (`AlreadyUsedNonce`).
- Recovers the EIP-712 signer; must equal `payer` (`InvalidSignature`).
- Marks the nonce used.
- `SafeERC20.safeTransferFrom(payer, merchant, amount)`.
- Emits `Settled`.

Reentrancy-guarded; respects `whenNotPaused`.

### `pause()` / `unpause()`

Restricted to `PAUSER_ROLE`. Stops every `settle()` call.

---

## Events

```solidity
event Settled(
    bytes32 indexed orderHash,
    address indexed payer,
    address indexed merchant,
    address token,
    uint256 amount,
    uint256 nonce
);
```

The indexer watches this via `viem.watchContractEvent`.

---

## Roles

| Role                  | Capability               | Granted to                |
|-----------------------|--------------------------|---------------------------|
| `DEFAULT_ADMIN_ROLE`  | Grant/revoke roles       | Deployer (constructor)    |
| `PAUSER_ROLE`         | Pause/unpause `settle()` | Admin (off-deploy)        |

---

## Security properties

- **Nonce replay protection** — `(payer, nonce)` may only be used once.
- **Deadline enforcement** — orders past `deadline` revert.
- **Signature verification** — ECDSA recovery must equal `payer`; OZ's
  `ECDSA.recover` rejects malleable signatures.
- **No fund custody** — `safeTransferFrom(payer, merchant, amount)` moves
  tokens directly; the router never holds balance.
- **Pausable kill-switch** — `whenNotPaused` modifier on `settle()`.
- **Reentrancy guard** — `nonReentrant` on `settle()` (defense in depth;
  the contract makes only one external call and has no value-bearing
  callbacks).

---

## Testing

```bash
cd contracts
forge test -vv
forge coverage
forge snapshot
```

`PaymentRouterTest` covers the happy path, all reverts, the emitted event,
nonce replay, and pause behavior — 9 tests at last run.

---

## Deployment

```bash
forge create src/PaymentRouter.sol:PaymentRouter \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

After deploy, set `PAYMENT_ROUTER_ADDRESS` in:

- `services/tx-submitter/.env`
- `services/indexer/.env`
