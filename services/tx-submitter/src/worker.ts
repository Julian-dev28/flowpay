import { Worker } from "bullmq";
import { env } from "./env";

const connection = {
  host: env.REDIS_HOST,
  port: parseInt(env.REDIS_PORT, 10),
};

const worker = new Worker(
  "payment.submit",
  async (job) => {
    console.log(`Processing job ${job.id}:`, job.data);
    // TODO: implement tx submission
    return { status: "acked", jobId: job.id };
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

console.log("tx-submitter worker started, listening on payment.submit queue");

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down tx-submitter...");
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
