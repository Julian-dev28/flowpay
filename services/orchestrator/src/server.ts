import Fastify from "fastify";
import { env } from "./env";
import promClient from "prom-client";

const app = Fastify({
  logger: true,
});

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

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down orchestrator...");
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start server
const start = async () => {
  try {
    await app.listen({ port: parseInt(env.PORT, 10), host: env.HOST });
    console.log(`orchestrator listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
