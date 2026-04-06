import { Worker } from "bullmq";
import { env } from "./env";
import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const connection = {
  host: env.REDIS_HOST,
  port: parseInt(env.REDIS_PORT, 10),
};

// PaymentRouter ABI
const paymentRouterABI = parseAbi([
  "function settle(address merchant, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes signature) external",
  "event Settled(bytes32 indexed orderHash, address indexed merchant, address token, uint256 amount, uint256 nonce)",
]);

// Create wallet client for signing transactions
const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(env.CHAIN_RPC_URL),
});

const worker = new Worker(
  "payment.submit",
  async (job) => {
    const { paymentId, merchant, token, amount, nonce, deadline, signature } = job.data;
    console.log(`Processing job ${job.id} for payment ${paymentId}:`, { merchant, token, amount });

    // TODO: Replace with actual deployed contract address
    const contractAddress = env.PAYMENT_ROUTER_ADDRESS as `0x${string}`;
    if (contractAddress === "0x0000000000000000000000000000000000000") {
      console.log("Stub: would call settle() on PaymentRouter");
      return { status: "stub", paymentId, jobId: job.id };
    }

    // Call contract's settle function
    try {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: paymentRouterABI,
        functionName: "settle",
        args: [merchant as `0x${string}`, token as `0x${string}`, BigInt(amount), BigInt(nonce), BigInt(deadline), signature as `0x${string}`],
      });

      console.log(`Transaction submitted: ${hash}`);
      return { status: "submitted", txHash: hash, paymentId };
    } catch (err) {
      console.error(`Failed to submit transaction for job ${job.id}:`, err);
      throw err; // Let BullMQ handle retry
    }
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
