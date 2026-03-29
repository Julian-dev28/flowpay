import { Queue } from "bullmq";

const queue = new Queue("payment.submit", {
  connection: {
    host: "localhost",
    port: 6379,
  },
});

queue
  .add("test-job", { foo: "bar", paymentId: "test-123" })
  .then((job) => {
    console.log("Job added:", job.id);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
