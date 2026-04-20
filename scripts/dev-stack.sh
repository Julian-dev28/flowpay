#!/usr/bin/env bash
# Boots the full FlowPay backend against a fresh local anvil:
#   - anvil on :8545
#   - PaymentRouter + MockUSDC deployed
#   - orchestrator on :3001 (CORS allows http://localhost:3000)
#   - tx-submitter (relayer EOA = anvil #0)
#   - indexer on :3002 watching the deployed router
#
# Then prints the deployed addresses so the frontend can pick them up.
# Run `pnpm -F @flowpay/frontend dev` in another terminal for the UI.
#
# Requires: anvil (foundry), redis on :6379, pnpm install already done.
set -eo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"

ROOT=$(pwd)
LOG_DIR="${FLOWPAY_LOG_DIR:-$ROOT/.dev-logs}"
mkdir -p "$LOG_DIR"

ANVIL_PORT=8545
ORCH_PORT=3001
IDX_PORT=3002

# anvil deterministic account #0 — also used as relayer EOA
RELAYER_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

PIDS=()
cleanup() {
  echo
  echo "▶ stopping dev stack…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.5
  for pid in "${PIDS[@]:-}"; do
    kill -9 "$pid" 2>/dev/null || true
  done
  echo "▶ done."
}
trap cleanup INT TERM EXIT

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "✗ missing dependency: $1"; exit 1; }
}
require anvil
require forge
require redis-cli
require node
require pnpm

# Redis sanity
if ! redis-cli ping > /dev/null 2>&1; then
  echo "✗ redis is not running on localhost:6379. Try: brew services start redis"
  exit 1
fi

# Free the ports we need.
for port in "$ANVIL_PORT" "$ORCH_PORT" "$IDX_PORT"; do
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "▶ freeing port $port (killing $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

echo "▶ flushing redis…"
redis-cli FLUSHDB > /dev/null

echo "▶ starting anvil…"
anvil --chain-id 31337 --port "$ANVIL_PORT" > "$LOG_DIR/anvil.log" 2>&1 &
PIDS+=($!)
# wait for anvil
for i in {1..40}; do
  if curl -s -X POST "http://localhost:$ANVIL_PORT" \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      2>/dev/null | grep -q "0x7a69"; then
    break
  fi
  sleep 0.25
  if [ "$i" = 40 ]; then echo "✗ anvil did not come up in time"; exit 1; fi
done

echo "▶ deploying PaymentRouter + MockUSDC…"
( cd contracts && forge script script/DeployDemo.s.sol \
    --rpc-url "http://localhost:$ANVIL_PORT" \
    --private-key "$RELAYER_PK" \
    --broadcast > "$LOG_DIR/deploy.log" 2>&1 ) || {
  echo "✗ deploy failed; tail of log:"
  tail -20 "$LOG_DIR/deploy.log"
  exit 1
}

ROUTER=$(node -e '
  const j = require("./contracts/broadcast/DeployDemo.s.sol/31337/run-latest.json");
  console.log(j.transactions.find(t => t.contractName === "PaymentRouter").contractAddress);
')
USDC=$(node -e '
  const j = require("./contracts/broadcast/DeployDemo.s.sol/31337/run-latest.json");
  console.log(j.transactions.find(t => t.contractName === "MockUSDC").contractAddress);
')

echo "▶ starting orchestrator on :$ORCH_PORT…"
( cd services/orchestrator && \
    PORT="$ORCH_PORT" \
    LOG_LEVEL=info \
    CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000" \
    npx tsx src/server.ts > "$LOG_DIR/orchestrator.log" 2>&1 ) &
PIDS+=($!)

echo "▶ starting tx-submitter (relayer = anvil #0)…"
( cd services/tx-submitter && \
    PAYMENT_ROUTER_ADDRESS="$ROUTER" \
    PRIVATE_KEY="$RELAYER_PK" \
    CHAIN_ID=31337 \
    CHAIN_RPC_URL="http://localhost:$ANVIL_PORT" \
    LOG_LEVEL=info \
    npx tsx src/worker.ts > "$LOG_DIR/tx-submitter.log" 2>&1 ) &
PIDS+=($!)

echo "▶ starting indexer on :$IDX_PORT…"
( cd services/indexer && \
    PAYMENT_ROUTER_ADDRESS="$ROUTER" \
    CHAIN_ID=31337 \
    RPC_URL="http://localhost:$ANVIL_PORT" \
    PORT="$IDX_PORT" \
    CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000" \
    LOG_LEVEL=info \
    npx tsx src/main.ts > "$LOG_DIR/indexer.log" 2>&1 ) &
PIDS+=($!)

# wait for health
echo "▶ waiting for services…"
for i in {1..50}; do
  if curl -fsS "http://localhost:$ORCH_PORT/healthz" >/dev/null 2>&1 \
     && curl -fsS "http://localhost:$IDX_PORT/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

cat <<EOF

  ┌──────────────────────────── FlowPay dev stack ────────────────────────────┐
  │  anvil          http://localhost:$ANVIL_PORT          (chain id 31337)        │
  │  orchestrator   http://localhost:$ORCH_PORT          /healthz /pay /payments  │
  │  indexer        http://localhost:$IDX_PORT          /healthz /events          │
  │                                                                            │
  │  PaymentRouter  $ROUTER       │
  │  MockUSDC       $USDC       │
  │  Demo payer     0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (anvil #1)       │
  │  Merchant       0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (anvil #2)       │
  │                                                                            │
  │  Logs: $LOG_DIR
  │                                                                            │
  │  ▶ Now run the frontend in another terminal:                               │
  │      pnpm -F @flowpay/frontend dev                                         │
  │    then open http://localhost:3000                                         │
  │                                                                            │
  │  Ctrl-C here to tear it all down.                                          │
  └────────────────────────────────────────────────────────────────────────────┘

EOF

# Block until any backgrounded service exits or user hits Ctrl-C.
# (macOS bash 3.2 doesn't have `wait -n`, so we poll the PIDs.)
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "✗ a service (pid $pid) exited — see logs in $LOG_DIR"
      exit 1
    fi
  done
  sleep 2
done
