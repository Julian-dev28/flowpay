import Fastify from "fastify";
import pino from "pino";
import { env } from "./env";
import promClient from "prom-client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PayRequestSchema, QuoteRequestSchema } from "./schemas";
import { randomUUID } from "crypto";

const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.LOG_LEVEL === "debug" ? { target: "pino-pretty" } : undefined,
});

const app = Fastify({
  logger: logger,
});

// Redis connection for BullMQ
const connection = new IORedis(env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Payment submission queue
const paymentQueue = new Queue("payment.submit", { connection });

// Prometheus metrics registry
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

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

  // Check Redis
  try {
    const pong = await connection.ping();
    checks.redis = pong === "PONG";
  } catch {
    checks.redis = false;
  }

  // Check queue (BullMQ queue is available)
  try {
    const jobCounts = await paymentQueue.getJobCounts();
    checks.queue = jobCounts != null;
  } catch {
    checks.queue = false;
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
    return reply.code(400).send({
      error: "Invalid request body",
      details: parseResult.error.issues,
    });
  }

  const payRequest = parseResult.data;
  const paymentId = randomUUID();

  // Enqueue job to tx-submitter with retry options
  const job = await paymentQueue.add("process-payment", {
    paymentId,
    ...payRequest,
  }, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  });

  reply.code(202).send({
    jobId: job.id,
    paymentId,
  });
});

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down orchestrator...");
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
