# FlowPay end-to-end demo

This runs the whole pipeline locally against `anvil`. A signed
`PaymentOrder` posted to the orchestrator's `/pay` endpoint becomes an
on-chain `settle()` call that moves Mock USDC from the payer directly to
the merchant, and the indexer picks the resulting `Settled` event up.

## The one-command path

```bash
pnpm install
pnpm stack                             # terminal 1 — anvil + deploy + 3 services
pnpm -F @flowpay/frontend dev          # terminal 2 — UI on :3000
# optional:
pnpm demo                              # terminal 3 — fire one payment via the script
```

`pnpm stack` runs `scripts/dev-stack.sh`: it boots anvil, runs the deploy
script, picks the deployed addresses out of the broadcast log, then starts
the orchestrator (`:3001`), tx-submitter (relayer EOA = anvil #0), and
indexer (`:3002`) with the right envs. Logs land in `.dev-logs/`. Ctrl-C
tears everything down.

The rest of this doc is the manual path, useful when you want to debug a
single service in isolation.

## What you'll see

```
Demo payment
  payer    : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  merchant : 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
  …
POST /pay → 202 { jobId: '1', paymentId: '…' }
merchant balance 0 → 50000000  (delta 50000000)
settled on-chain ✔
```

…and in the indexer's log:

```
Settled event saved: {
  orderHash: '0x…',
  payer: '0x70997970C…',
  merchant: '0x3C44CdDdB…',
  token: '0xe7f1725E7…',
  amount: '50000000',
  nonce: '…',
  timestamp: …
}
```

## Prerequisites

- Foundry (`anvil`, `forge`)
- Node 20 + pnpm 9
- A local Redis on `localhost:6379` (e.g. `brew services start redis`)

## Steps

All commands run from the repo root unless stated otherwise.

```bash
# 1. Install
pnpm install
```

Open four terminals (or use `tmux`/`zellij`/your favorite multiplexer).

```bash
# Terminal 1: anvil
anvil
```

```bash
# Terminal 2: deploy + capture addresses
cd contracts
forge script script/DeployDemo.s.sol \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast

# The PaymentRouter / MockUSDC addresses are printed by the script and
# also saved to contracts/broadcast/DeployDemo.s.sol/31337/run-latest.json
# — the demo driver reads from there automatically.
```

```bash
# Terminal 3: orchestrator
pnpm -F @flowpay/orchestrator dev
# → "Orchestrator listening on 0.0.0.0:3001"
```

```bash
# Terminal 4: tx-submitter (relayer EOA = anvil account #0)
cd services/tx-submitter
PAYMENT_ROUTER_ADDRESS=<router-from-step-2> \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
CHAIN_ID=31337 \
CHAIN_RPC_URL=http://localhost:8545 \
pnpm dev
# → "tx-submitter wallet loaded" + "worker started"
```

```bash
# Terminal 5: indexer
cd services/indexer
PAYMENT_ROUTER_ADDRESS=<router-from-step-2> \
CHAIN_ID=31337 \
RPC_URL=http://localhost:8545 \
pnpm dev
# → "FlowPay indexer started — chain chain-31337 (id 31337), rpc http://localhost:8545"
```

With all five terminals up:

```bash
# Terminal 6: fire the demo payment
pnpm -F @flowpay/scripts demo
```

The driver picks the deployed addresses up from
`contracts/broadcast/DeployDemo.s.sol/31337/run-latest.json`, signs an
EIP-712 `PaymentOrder` as anvil account #1 (the payer), POSTs it to
`/pay`, and polls the merchant's MockUSDC balance until it ticks up.

## What runs where

| Component       | Role                                                            |
|-----------------|-----------------------------------------------------------------|
| `anvil`         | Local EVM, chain id `31337`                                     |
| `PaymentRouter` | EIP-712 signed-payment contract — pushes funds payer → merchant |
| `MockUSDC`      | ERC-20 with 6 decimals, mints 1M to anvil account #1            |
| orchestrator    | Fastify on `:3001`. Validates and enqueues to BullMQ            |
| tx-submitter    | Pulls from BullMQ, calls `settle()` from a relayer EOA          |
| indexer         | Watches `Settled` events via `viem.watchContractEvent`          |
| `scripts/demo.ts` | One-shot CLI: sign + POST + poll until balance moves          |

## Knobs

The driver reads a few env vars when present (otherwise falls back to the
broadcast log and anvil defaults):

| Variable                 | Default                                                                    |
|--------------------------|----------------------------------------------------------------------------|
| `RPC_URL`                | `http://localhost:8545`                                                    |
| `ORCHESTRATOR_URL`       | `http://localhost:3001`                                                    |
| `CHAIN_ID`               | `31337`                                                                    |
| `AMOUNT_USDC`            | `50`                                                                       |
| `PAYMENT_ROUTER_ADDRESS` | parsed from `contracts/broadcast/DeployDemo.s.sol/31337/run-latest.json`   |
| `MOCK_USDC_ADDRESS`      | parsed from the same broadcast log                                         |

## Troubleshooting

- **Worker logs "stub mode (PRIVATE_KEY unset)"** — the tx-submitter env
  vars didn't make it into the worker's process. Re-export and restart.
- **`settle` reverts with `0xe450d38c`** — `ERC20InsufficientBalance`.
  The payer doesn't have enough MockUSDC. Re-run `DeployDemo.s.sol` so
  the mint is fresh.
- **`settle` reverts with `0x8baa579f`** — `InvalidSignature`. Chain id
  mismatch between signer and contract. The driver and services must
  all see `CHAIN_ID=31337` against anvil.
- **Balance never moves** — check the tx-submitter logs for a
  `transaction submitted` line. If absent, check that
  `PAYMENT_ROUTER_ADDRESS` is non-zero in the worker's env.
