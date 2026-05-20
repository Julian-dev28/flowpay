# FlowPay

[![CI](https://github.com/Julian-dev28/flowpay/actions/workflows/ci.yml/badge.svg)](https://github.com/Julian-dev28/flowpay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Solidity 0.8.26](https://img.shields.io/badge/Solidity-0.8.26-363636.svg)](contracts/src/PaymentRouter.sol)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-339933.svg)](.nvmrc)

EIP-712 signed crypto-payment orchestration on Base. Payers sign a typed
payment intent off-chain. A relayer settles it on-chain through
`PaymentRouter.settle()`, which pushes funds directly from the payer to the
merchant — the router never holds balance.

Monorepo: Solidity contracts, a Fastify orchestrator, a BullMQ tx-submitter
worker, an event indexer with an HTTP API, and a Next.js / wagmi / RainbowKit
frontend.

> 10 forge tests, 100% coverage of `PaymentRouter.sol`. Runs end-to-end
> locally with one command (see *Quick start* below).

## Architecture

```
flowpay/
├── contracts/            # Foundry project (PaymentRouter.sol, EIP-712, AccessControl, Pausable, SafeERC20)
├── services/
│   ├── orchestrator/     # Fastify 5 — accepts signed payment intents, enqueues to BullMQ
│   ├── tx-submitter/     # BullMQ 5 worker — pulls jobs, signs/sends settle() tx via viem
│   └── indexer/          # viem watcher + Fastify HTTP — tails Settled events, exposes /events
├── apps/
│   └── frontend/         # Next.js 15 App Router + wagmi 2 + RainbowKit 2 + viem 2 + TanStack Query
├── packages/
│   ├── shared-types/     # Zod schemas (PaymentIntent, Quote)
│   ├── eip712/           # Typed-data builders
│   └── tsconfig/         # Shared TS config
└── scripts/              # demo.ts (one-shot end-to-end driver), dev-stack.sh (local stack)
```

## Prerequisites

- Node 20+, pnpm 9
- Foundry (`forge`, `anvil`, `cast`)
- Redis on `localhost:6379` (`brew services start redis` on macOS)

## Quick start

```bash
pnpm install

# Terminal 1: anvil + contracts + orchestrator + tx-submitter + indexer
pnpm stack

# Terminal 2: frontend (pnpm dev is an alias)
pnpm dev                          # http://localhost:3000
```

That's it. `pnpm stack` deploys `PaymentRouter` + `MockUSDC` to anvil, mints
the demo payer 1,000,000 MockUSDC, and starts the three backend services
with the right envs already wired. The frontend's defaults match the
deterministic anvil addresses, so connecting any wallet to chain id 31337
and clicking *Sign & pay* will land an on-chain `settle()` transaction.

> Don't run the backend services with `turbo run dev` — each service needs
> a coordinated startup (anvil first, then contracts deployed, then the
> services with router/relayer envs). `pnpm stack` does that orchestration;
> the per-service `pnpm -F @flowpay/<svc> dev` commands are for debugging
> one service in isolation.

### Fire a payment without the UI

```bash
pnpm demo
```

Signs as anvil account #1, POSTs to the orchestrator's `/pay`, polls the
merchant's balance, exits non-zero on timeout. See `docs/DEMO.md` for the
walkthrough.

## API surface

### Orchestrator (`:3001`)

| Method | Path                   | Purpose                                                      |
|--------|------------------------|--------------------------------------------------------------|
| GET    | `/healthz`             | liveness                                                     |
| GET    | `/readyz`              | redis + queue deep check                                     |
| GET    | `/metrics`             | Prometheus exposition (process + custom counters/histograms) |
| GET    | `/quote`               | stub quote, 1:1 ratio — placeholder for 0x integration       |
| GET    | `/payments/:jobId`     | BullMQ job state for a submitted payment                     |
| POST   | `/pay`                 | accepts signed `PaymentOrder`, enqueues to `payment.submit`  |

### Indexer (`:3002`)

| Method | Path                                  | Purpose                                       |
|--------|---------------------------------------|-----------------------------------------------|
| GET    | `/healthz`                            | chain id, block height, events buffered       |
| GET    | `/events?limit=&payer=&merchant=`     | recent Settled events (in-memory ring buffer) |

See `docs/API.md` for request/response shapes.

## Contracts

`PaymentRouter.sol` (Solidity 0.8.26):

- EIP-712 signed `PaymentOrder` (`payer, merchant, token, amount, nonce, deadline`)
- `AccessControl` (`PAUSER_ROLE`) + `Pausable`
- Per-`(payer, nonce)` replay protection via `usedNonces` mapping
- `ReentrancyGuard` on `settle()`
- `SafeERC20.safeTransferFrom(payer, merchant, amount)` — router never holds funds
- Any relayer can submit the signed order; the payer's pre-approval
  (`IERC20.approve(router, …)`) authorizes the pull

## Testing

```bash
cd contracts && forge test -vv      # 10/10 passing
cd contracts && forge coverage      # 100% lines/statements/branches/functions on PaymentRouter
cd contracts && forge snapshot      # gas

pnpm -r --filter "!@flowpay/contracts" build   # typecheck/build every TS package
```

CI re-runs all of the above on every push and PR.

## Tech stack

- **Contracts:** Solidity 0.8.26, OpenZeppelin v5, Foundry, viaIR optimizer
- **Backend:** Fastify 5, BullMQ 5, ioredis 5, pino, prom-client, viem 2
- **Frontend:** Next.js 15, React 19, wagmi 2, RainbowKit 2, viem 2, TanStack Query 5
- **Tooling:** pnpm workspaces, Turborepo, TypeScript 5, GitHub Actions

## Known limitations

- tx-submitter serializes via `concurrency: 1` rather than a proper local-nonce
  mutex — fine for a v0 throughput target, would need to change before any
  real production load.
- Indexer keeps Settled events in memory only; production swaps the
  ring buffer for Postgres/Clickhouse.
- Orchestrator's `/quote` is a 1:1 stub — placeholder for 0x Swap API v2.

## License

MIT
