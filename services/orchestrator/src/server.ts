import Fastify from "fastify";
import { env } from "./env";
import promClient from "prom-client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PayRequestSchema } from "./schemas";
import { randomUUID } from "crypto";

const app = Fastify({
  logger: true,
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

// Readiness check
app.get("/readyz", async () => {
  return { status: "ok" };
});

// Metrics endpoint
app.get("/metrics", async (_request, reply) => {
  reply.header("Content-Type", register.contentType);
  return reply.send(await register.metrics());
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

  // Enqueue job to tx-submitter
  const job = await paymentQueue.add("process-payment", {
    paymentId,
    ...payRequest,
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
    console.log(`Orchestrator listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
