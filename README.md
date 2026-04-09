# FlowPay

Mesh-style crypto payments orchestration — built for Web3 hackathons and production-grade payment flows.

## Architecture

```
flowpay/
├── contracts/          # Solidity contracts (PaymentRouter, EIP-712)
├── services/
│   ├── orchestrator/ # Fastify API (pay, quote endpoints)
│   ├── tx-submitter/ # BullMQ worker (contract calls via viem)
│   └── indexer/      # Event watcher (Settled events via viem)
├── apps/
│   └── frontend/     # Next.js 15 + wagmi + RainbowKit
└── packages/
    ├── shared-types/  # Zod schemas (PaymentIntent, Quote)
    └── tsconfig/      # Shared TypeScript config
```

## Prerequisites

- Node.js 20+
- pnpm 9+
- Redis (local or Docker)
- Foundry (for contracts)
- Anvil (local node, optional)

## Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Copy .env.example files
cp contracts/.env.example contracts/.env
cp services/orchestrator/.env.example services/orchestrator/.env
cp services/tx-submitter/.env.example services/tx-submitter/.env
cp services/indexer/.env.example services/indexer/.env
cp apps/frontend/.env.example apps/frontend/.env
```

## Running Locally

```bash
# Start Redis (if not running)
redis-server --daemonize yes

# Start all services
pnpm dev

# Or individually:
pnpm -F @flowpay/orchestrator dev   # :3001
pnpm -F @flowpay/tx-submitter dev  # worker
pnpm -F @flowpay/indexer dev     # event watcher
pnpm -F @flowpay/frontend dev     # :3000
```

## Testing

```bash
# Contracts (Forge)
cd contracts && forge test -vv

# Coverage
forge coverage

# All packages
pnpm -r test
```

## API Endpoints

### Orchestrator (:3001)

- `GET /healthz` — health check
- `GET /readyz` — readiness check (Redis + queue)
- `GET /metrics` — Prometheus metrics
- `GET /quote? sellToken=0x...&buyToken=0x...&sellAmount=1000000` — get quote (stub)
- `POST /pay` — submit payment intent (enqueues to tx-submitter)

## Contracts

- `PaymentRouter.sol` — EIP-712 signed payments, permit2 integration
- Coverage: 90% lines, 95% statements, 100% branches

## Tech Stack

- **Contracts**: Solidity 0.8.26, OpenZeppelin v5, Foundry
- **Backend**: Fastify 5, BullMQ 5, ioredis 5, pino 10
- **Frontend**: Next.js 15, React 19, wagmi 2, RainbowKit 2, viem 2
- **Shared**: TypeScript 5, Zod 3, pnpm workspaces, Turborepo

## License

MIT
