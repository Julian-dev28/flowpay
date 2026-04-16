import Fastify from "fastify";
import { env } from "./env";
import promClient from "prom-client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PayRequestSchema, QuoteRequestSchema } from "./schemas";
import { randomUUID } from "crypto";
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
