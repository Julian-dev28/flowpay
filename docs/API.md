# FlowPay API Documentation

Base URL: `http://localhost:3001` (orchestrator)

## Endpoints

### `GET /healthz`

Simple health check.

**Response (200):**
```json
{ "status": "ok" }
```

---

### `GET /readyz`

Readiness check — verifies Redis connectivity and queue health.

**Response (200):**
```json
{
  "status": "ready",
  "checks": { "redis": true, "queue": true }
}
```

---

### `GET /metrics`

Prometheus metrics endpoint.

**Response:** Prometheus text format (`Content-Type: text/plain`)

---

### `GET /quote`

Get a swap quote (stub for 0x integration).

**Query Params:**
| Param | Type | Description |
|-------|------|------------|
| `sellToken` | `string` | Token address to sell |
| `buyToken` | `string` | Token address to buy |
| `sellAmount` | `string` | Amount to sell (in smallest unit) |

**Response (200):**
```json
{
  "chainId": 84532,
  "sellToken": "0x...",
  "buyToken": "0x...",
  "sellAmount": "1000000",
  "buyAmount": "1000000",
  "allowanceTarget": "0x...",
  "to": "0x...",
  "data": "0x...",
  "value": "0"
}
```

---

### `POST /pay`

Submit a signed payment intent. Enqueues to `payment.submit` BullMQ queue.

**Request Body:**
```json
{
  "merchant": "0x...",
  "token": "0x...",
  "amount": "100000000",
  "nonce": 0,
  "deadline": 9999999999,
  "signature": "0x..."
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "123",
  "paymentId": "uuid..."
}
```

**Error Response (400):**
```json
{
  "error": "Invalid request body",
  "details": [...]
}
```

---

## Queue Jobs

### `payment.submit` (BullMQ)

**Job Data:**
```json
{
  "paymentId": "uuid...",
  "merchant": "0x...",
  "token": "0x...",
  "amount": "100000000",
  "nonce": 0,
  "deadline": 9999999999,
  "signature": "0x..."
}
```

**Attempts:** 3 (exponential backoff)

**Dead-letter queue:** `payment.dead-letter` (after max attempts)

---

## Contract Interaction

The tx-submitter worker processes `payment.submit` jobs by calling `PaymentRouter.settle()` on-chain.

**Contract:** `PaymentRouter.sol` (Base Sepolia)
**Function:** `settle(address merchant, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)`
**Event:** `Settled(bytes32 orderHash, address merchant, address token, uint256 amount, uint256 nonce)`
