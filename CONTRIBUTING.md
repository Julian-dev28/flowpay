# Contributing to FlowPay

Thank you for your interest in contributing to FlowPay!

## Development Setup

1. Fork the repo
2. Clone: `git clone https://github.com/YOUR_USERNAME/flowpay.git`
3. Install: `pnpm install`
4. Build: `pnpm -r build`

## Project Structure

- `contracts/` — Solidity contracts (Forge)
- `services/` — Backend microservices (Fastify, BullMQ)
- `apps/` — Frontend apps (Next.js)
- `packages/` — Shared TypeScript packages

## Making Changes

1. Create a branch: `git checkout -b feat/your-feature`
2. Make changes
3. Run tests: `pnpm -r test` (or `cd contracts && forge test -vv`)
4. Commit: `git commit -m "feat: add your feature"`
5. Push: `git push origin feat/your-feature`
6. Open PR

## Testing

### Contracts
```bash
cd contracts
forge test -vv           # Run tests
forge coverage           # Coverage report
forge snapshot           # Gas snapshot
```

### Services & Apps
```bash
pnpm -r test           # If tests exist
pnpm -r build          # Verify build
```

## Code Style

- TypeScript: strict mode, no `any`
- Solidity: 0.8.26, via IR, OpenZeppelin v5
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, etc.)

## Pull Request Guidelines

- Keep PRs focused (one feature/fix per PR)
- Add tests for new functionality
- Update docs if needed
- Ensure all checks pass

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
