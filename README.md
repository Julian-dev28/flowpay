# FlowPay

EIP-712 signed crypto-payment orchestration on Base. Monorepo: Solidity contracts, a Fastify orchestrator, a BullMQ tx-submitter worker, an event indexer, and a Next.js frontend.

> Status: scaffold + happy path. PaymentRouter ships with 10 passing forge tests (100% line/statement/branch/function coverage). Frontend connects a wallet via wagmi. Backend services boot cleanly and run end-to-end against a local anvil (see `docs/DEMO.md`). See QA_REPORT.md for the candid bug list and how it has been worked down.

## Architecture

```
flowpay/
├── contracts/            # Foundry project (PaymentRouter.sol, EIP-712, AccessControl, Pausable)
├── services/
│   ├── orchestrator/     # Fastify HTTP API — accepts signed payment intents, enqueues to Redis
│   ├── tx-submitter/     # BullMQ worker — pulls jobs, signs/sends settle() tx via viem
│   └── indexer/          # viem event watcher — tails Settled events, keeps in-memory log
├── apps/
│   └── frontend/         # Next.js 15 App Router + wagmi 2 + viem 2 + TanStack Query
└── packages/
    ├── shared-types/     # Zod schemas (PaymentIntent, Quote)
    ├── eip712/           # Typed-data builders
    └── tsconfig/         # Shared TS config
```

## Prerequisites

- Node 20+, pnpm 9
- Foundry (`forge`, `anvil`, `cast`)
- Redis (local or Docker)

## Setup

```bash
pnpm install
pnpm -r build

# Per-service env files
cp services/orchestrator/.env.example services/orchestrator/.env
cp services/tx-submitter/.env.example services/tx-submitter/.env
cp services/indexer/.env.example services/indexer/.env
cp apps/frontend/.env.example apps/frontend/.env
# contracts/.env not yet checked in — create one with RPC_URL + DEPLOYER_PK if deploying
```

## Running locally

Root-level `pnpm dev` is not currently a reliable entry point — start each service in its own terminal:

```bash
redis-server --daemonize yes
pnpm -F @flowpay/orchestrator dev   # http://localhost:3001
pnpm -F @flowpay/tx-submitter dev   # BullMQ worker, no HTTP
pnpm -F @flowpay/indexer dev        # event watcher, no HTTP
pnpm -F @flowpay/frontend dev       # http://localhost:3000
```

For an end-to-end run, also start an `anvil` fork or point `CHAIN_RPC_URL` at a Base Sepolia RPC and set `PAYMENT_ROUTER_ADDRESS` after deploy.

## Testing

```bash
cd contracts && forge test -vv      # 7 tests
cd contracts && forge coverage      # current PaymentRouter coverage
cd contracts && forge snapshot      # gas
```

Service packages do not yet expose `test` scripts; `pnpm -r test` is a no-op today.

## API surface (orchestrator, :3001)

| Method | Path        | Purpose                                                      |
|--------|-------------|--------------------------------------------------------------|
| GET    | `/healthz`  | liveness                                                     |
| GET    | `/readyz`   | redis + queue deep check                                     |
| GET    | `/metrics`  | Prometheus exposition (process + custom counters/histograms) |
| GET    | `/quote`    | stub quote, 1:1 ratio — placeholder for 0x integration       |
| POST   | `/pay`      | accepts signed `PaymentOrder`, enqueues to `payment.submit`  |

See `docs/API.md` for request shapes.

## Contracts

`PaymentRouter.sol` (Solidity 0.8.26):

- EIP-712 signed `PaymentOrder` (`payer, merchant, token, amount, nonce, deadline`)
- `AccessControl` (`PAUSER_ROLE`) + `Pausable`
- Per-`(payer, nonce)` replay protection via `usedNonces` mapping
- `ReentrancyGuard` on `settle()`
- `SafeERC20.safeTransferFrom(payer, merchant, amount)` — router never holds funds
- Any relayer can submit the signed order; the payer's pre-approval (`IERC20.approve(router, …)`) authorizes the pull

Coverage figures live in `forge coverage` output; regenerate before quoting them.

## Tech stack

- **Contracts:** Solidity 0.8.26, OpenZeppelin v5, Foundry, viaIR optimizer
- **Backend:** Fastify 5, BullMQ 5, ioredis 5, pino, prom-client, viem 2
- **Frontend:** Next.js 15, React 19, wagmi 2, viem 2, TanStack Query 5
- **Tooling:** pnpm workspaces, Turborepo, TypeScript 5

## Known gaps

See `QA_REPORT.md` for the bug list, marked with the commits that closed each item. Open work:

- tx-submitter serializes via `concurrency: 1` rather than a proper local-nonce mutex — fine for v0 throughput, would need to change before production load
- `pnpm dev` (turbo run dev) still isn't a clean four-pane launch; per-service `pnpm -F … dev` works and is what `docs/DEMO.md` uses
- No persistence: indexer keeps Settled events in memory only, orchestrator's PaymentIntent state never escapes BullMQ

## License

MIT
