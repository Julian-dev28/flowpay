import { Worker, Queue } from "bullmq";
import { env } from "./env";
import {
  createWalletClient,
  http,
  parseAbi,
  zeroAddress,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { logger } from "./logger";

const connection = {
  host: env.REDIS_HOST,
  port: parseInt(env.REDIS_PORT, 10),
};

// Dead-letter queue for permanently failed jobs
const deadLetterQueue = new Queue("payment.dead-letter", { connection });

// PaymentRouter ABI — keep in sync with contracts/src/PaymentRouter.sol.
const paymentRouterABI = parseAbi([
  "function settle(address payer, address merchant, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes signature) external",
  "event Settled(bytes32 indexed orderHash, address indexed payer, address indexed merchant, address token, uint256 amount, uint256 nonce)",
]);

// Lazily construct the wallet client only when we have a real key.
// privateKeyToAccount() crashes on invalid scalars (e.g. 0x000…0), so we must
// never build it from a sentinel value.
let walletClient: WalletClient | null = null;
let walletAddress: `0x${string}` | null = null;
if (env.PRIVATE_KEY) {
  const account: Account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(env.CHAIN_RPC_URL),
  });
  walletAddress = account.address;
  logger.info({ walletAddress }, "tx-submitter wallet loaded");
} else {
  logger.info("tx-submitter: PRIVATE_KEY not set — worker runs in stub mode");
}

const routerAddress = env.PAYMENT_ROUTER_ADDRESS.toLowerCase() as `0x${string}`;
const routerConfigured = routerAddress !== zeroAddress;

const worker = new Worker(
  "payment.submit",
  async (job) => {
    const { paymentId, payer, merchant, token, amount, nonce, deadline, signature } = job.data;
    logger.info(
      { jobId: job.id, paymentId, payer, merchant, token, amount },
      "processing payment job"
    );

    // Stub mode: no router deployed or no signing key — log and ack.
    if (!routerConfigured || !walletClient) {
      const reason = !routerConfigured
        ? "PAYMENT_ROUTER_ADDRESS unset"
        : "PRIVATE_KEY unset";
      logger.info({ reason, paymentId, jobId: job.id }, "stub mode: skipping settle() call");
      return { status: "stub", reason, paymentId, jobId: job.id };
    }

    try {
      const hash = await walletClient.writeContract({
        account: walletClient.account!,
        chain: baseSepolia,
        address: env.PAYMENT_ROUTER_ADDRESS as `0x${string}`,
        abi: paymentRouterABI,
        functionName: "settle",
        args: [
          payer as `0x${string}`,
          merchant as `0x${string}`,
          token as `0x${string}`,
          BigInt(amount),
          BigInt(nonce),
          BigInt(deadline),
          signature as `0x${string}`,
        ],
      });

      logger.info({ txHash: hash, paymentId, jobId: job.id }, "transaction submitted");
      return { status: "submitted", txHash: hash, paymentId };
    } catch (err) {
      logger.error({ err, jobId: job.id }, "failed to submit transaction");
      throw err; // let BullMQ handle retry
    }
  },
  {
    connection,
    // Serialize jobs on a single EOA — viem fetches the nonce per call, so
    // parallel writes race and produce "nonce too low" / replaced-tx errors.
    // A real implementation would track a local nonce counter under a mutex.
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "job completed");
});

worker.on("failed", async (job, err) => {
  logger.error({ jobId: job?.id, err }, "job failed");

  if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
    await deadLetterQueue.add("dead-letter", {
      originalJobId: job.id,
      paymentId: job.data.paymentId,
      failedReason: err?.message || "Unknown error",
      data: job.data,
    });
    logger.warn({ jobId: job.id }, "job moved to dead-letter queue");
  }
});

logger.info("tx-submitter worker started, listening on payment.submit queue");

const shutdown = async () => {
  logger.info("Shutting down tx-submitter…");
  await worker.close();
  await deadLetterQueue.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
