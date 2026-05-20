import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env";
import promClient from "prom-client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PayRequestSchema, QuoteRequestSchema, FaucetRequestSchema } from "./schemas";
import { randomUUID } from "crypto";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  parseEther,
  parseUnits,
  defineChain,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
// types/fastify.d.ts augments FastifyRequest with `requestId` and `startTime`

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(env.LOG_LEVEL === "debug"
      ? { transport: { target: "pino-pretty" } }
      : {}),
  },
});
const logger = app.log;

// CORS — allow browser-side dApps to call /pay, /quote, etc. Registered
// before decorateRequest so the fastify type inference stays clean.
const allowedOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.register(cors, {
  origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"],
  credentials: false,
  maxAge: 86400,
});

// Strongly-typed request decorators so we don't reach for `as any` in hooks.
app.decorateRequest("requestId", "");
app.decorateRequest("startTime", 0);

// Redis connection for BullMQ
const connection = new IORedis(env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Payment submission queue
const paymentQueue = new Queue("payment.submit", { connection });

// Prometheus metrics registry
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// Custom metrics
const paymentRequestsTotal = new promClient.Counter({
  name: "flowpay_payment_requests_total",
  help: "Total payment requests",
  labelNames: ["status"],
  registers: [register],
});

const quoteRequestsTotal = new promClient.Counter({
  name: "flowpay_quote_requests_total",
  help: "Total quote requests",
  registers: [register],
});

const requestDuration = new promClient.Histogram({
  name: "flowpay_request_duration_seconds",
  help: "Request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// Add request ID and timing hook
app.addHook("onRequest", async (request, _reply) => {
  request.startTime = Date.now();
  request.requestId = randomUUID();
  request.headers["x-request-id"] = request.requestId;
});

app.addHook("onResponse", async (request, reply) => {
  const duration = (Date.now() - request.startTime) / 1000;
  const route = request.url?.split("?")[0] || "unknown";
  requestDuration.observe(
    { method: request.method, route, status_code: reply.statusCode.toString() },
    duration
  );
  logger.info(
    {
      requestId: request.requestId,
      method: request.method,
      route,
      statusCode: reply.statusCode,
      duration,
    },
    "request completed"
  );
});

// Health check
app.get("/healthz", async () => {
  return { status: "ok" };
});

// Readiness check - deep health
app.get("/readyz", async () => {
  const checks = {
    redis: false,
    queue: false,
  };

  try {
    const pong = await connection.ping();
    checks.redis = pong === "PONG";
  } catch (err) {
    logger.warn({ err }, "readyz: redis ping failed");
  }

  try {
    const jobCounts = await paymentQueue.getJobCounts();
    checks.queue = jobCounts != null;
  } catch (err) {
    logger.warn({ err }, "readyz: queue check failed");
  }

  const isReady = checks.redis && checks.queue;
  return {
    status: isReady ? "ready" : "not ready",
    checks,
  };
});

// Metrics endpoint
app.get("/metrics", async (_request, reply) => {
  reply.header("Content-Type", register.contentType);
  return reply.send(await register.metrics());
});

// Quote endpoint - return stub quote (0x integration later)
app.get("/quote", async (request) => {
  quoteRequestsTotal.inc();

  const parseResult = QuoteRequestSchema.safeParse(request.query);
  if (!parseResult.success) {
    return { error: "Invalid query parameters", details: parseResult.error.issues };
  }

  const { sellToken, buyToken, sellAmount } = parseResult.data;

  // Stub quote - 0x integration in later task
  return {
    chainId: 84532, // Base Sepolia
    sellToken,
    buyToken,
    sellAmount,
    buyAmount: sellAmount, // dummy: 1:1 for stub
    allowanceTarget: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    data: "0x",
    value: "0",
  };
});

// ── Faucet (dev only) ────────────────────────────────────────────────────
// POST /faucet { address } → sends ETH + mints MockUSDC to that address on
// the configured chain. Enabled only when FAUCET_ENABLED=true and a private
// key + token address are configured. Production replaces this with off-chain
// KYC / merchant onboarding flows; here it makes the live demo self-serve.
const faucetEnabled =
  env.FAUCET_ENABLED === "true" &&
  !!env.FAUCET_PRIVATE_KEY &&
  !!env.FAUCET_TOKEN_ADDRESS;

let faucetState: {
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
  account: Address;
  token: Address;
} | null = null;

if (faucetEnabled) {
  const chain = defineChain({
    id: env.FAUCET_CHAIN_ID,
    name: `chain-${env.FAUCET_CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.FAUCET_RPC_URL] } },
  });
  const account = privateKeyToAccount(env.FAUCET_PRIVATE_KEY as Hex);
  faucetState = {
    walletClient: createWalletClient({ account, chain, transport: http(env.FAUCET_RPC_URL) }),
    publicClient: createPublicClient({ chain, transport: http(env.FAUCET_RPC_URL) }),
    account: account.address,
    token: env.FAUCET_TOKEN_ADDRESS as Address,
  };
  logger.info(
    { faucet: faucetState.account, token: faucetState.token, chainId: chain.id },
    "faucet ready"
  );
}

// Per-address cooldown so a single client can't drain the relayer on anvil.
const FAUCET_COOLDOWN_MS = 10_000;
const lastFaucetAt = new Map<string, number>();

const MOCK_USDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function decimals() view returns (uint8)",
]);

app.get("/faucet", async () => {
  if (!faucetEnabled || !faucetState) {
    return { enabled: false };
  }
  return {
    enabled: true,
    token: faucetState.token,
    chainId: env.FAUCET_CHAIN_ID,
    ethDrop: env.FAUCET_ETH_DROP,
    tokenDrop: env.FAUCET_TOKEN_DROP,
  };
});

app.post("/faucet", async (request, reply) => {
  if (!faucetEnabled || !faucetState) {
    return reply.code(404).send({ error: "faucet disabled" });
  }
  const parseResult = FaucetRequestSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.code(400).send({ error: "invalid request", details: parseResult.error.issues });
  }
  const to = parseResult.data.address as Address;

  const now = Date.now();
  const last = lastFaucetAt.get(to.toLowerCase()) ?? 0;
  if (now - last < FAUCET_COOLDOWN_MS) {
    return reply.code(429).send({
      error: "rate limited",
      retryAfterMs: FAUCET_COOLDOWN_MS - (now - last),
    });
  }
  lastFaucetAt.set(to.toLowerCase(), now);

  try {
    const decimals = await faucetState.publicClient.readContract({
      address: faucetState.token,
      abi: MOCK_USDC_ABI,
      functionName: "decimals",
    });
    const tokenAmount = parseUnits(env.FAUCET_TOKEN_DROP, decimals as number);
    const ethAmount = parseEther(env.FAUCET_ETH_DROP);

    const ethTxHash = await faucetState.walletClient.sendTransaction({
      account: faucetState.walletClient.account!,
      chain: faucetState.walletClient.chain,
      to,
      value: ethAmount,
    });
    const mintTxHash = await faucetState.walletClient.writeContract({
      account: faucetState.walletClient.account!,
      chain: faucetState.walletClient.chain,
      address: faucetState.token,
      abi: MOCK_USDC_ABI,
      functionName: "mint",
      args: [to, tokenAmount],
    });

    logger.info({ to, ethTxHash, mintTxHash }, "faucet dispensed");
    return {
      to,
      ethDrop: env.FAUCET_ETH_DROP,
      tokenDrop: env.FAUCET_TOKEN_DROP,
      token: faucetState.token,
      ethTxHash,
      mintTxHash,
    };
  } catch (err) {
    logger.error({ err, to }, "faucet failed");
    return reply.code(500).send({
      error: err instanceof Error ? err.message : "faucet failed",
    });
  }
});

// Payment job status — frontend polls this to drive its lifecycle UI.
app.get<{ Params: { jobId: string } }>("/payments/:jobId", async (request, reply) => {
  const job = await paymentQueue.getJob(request.params.jobId);
  if (!job) {
    return reply.code(404).send({ error: "job not found" });
  }
  const state = await job.getState();
  return {
    jobId: job.id,
    paymentId: job.data?.paymentId,
    state, // waiting | active | completed | failed | delayed | paused
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    returnvalue: job.returnvalue,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
});

// Pay endpoint - accept payment intent and enqueue for processing
app.post("/pay", async (request, reply) => {
  const parseResult = PayRequestSchema.safeParse(request.body);
  if (!parseResult.success) {
    paymentRequestsTotal.inc({ status: "error" });
    return reply.code(400).send({
      error: "Invalid request body",
      details: parseResult.error.issues,
    });
  }

  const payRequest = parseResult.data;
  const paymentId = randomUUID();

  const job = await paymentQueue.add(
    "process-payment",
    {
      paymentId,
      ...payRequest,
    },
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    }
  );

  paymentRequestsTotal.inc({ status: "success" });
  reply.code(202).send({
    jobId: job.id,
    paymentId,
  });
});

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down orchestrator…");
  await paymentQueue.close();
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start server
const start = async () => {
  try {
    await app.listen({ port: parseInt(env.PORT, 10), host: env.HOST });
    logger.info(`Orchestrator listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
