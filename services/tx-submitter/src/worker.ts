import { Worker, Queue } from "bullmq";
import { env } from "./env";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  zeroAddress,
  defineChain,
  type WalletClient,
  type PublicClient,
  type Account,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { logger } from "./logger";
import { NonceManager } from "./nonce-manager";

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

function resolveChain(chainId: number, rpcUrl: string): Chain {
  if (chainId === baseSepolia.id) return baseSepolia;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}
const chain = resolveChain(env.CHAIN_ID, env.CHAIN_RPC_URL);

// Lazily construct the wallet client + nonce manager only when we have a real
// key. privateKeyToAccount() crashes on invalid scalars (e.g. 0x000…0), so we
// must never build it from a sentinel value.
let walletClient: WalletClient | null = null;
let publicClient: PublicClient | null = null;
let walletAddress: `0x${string}` | null = null;
let nonceManager: NonceManager | null = null;

async function initWallet() {
  if (!env.PRIVATE_KEY) {
    logger.info("tx-submitter: PRIVATE_KEY not set — worker runs in stub mode");
    return;
  }
  const account: Account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  walletClient = createWalletClient({
    account,
    chain,
    transport: http(env.CHAIN_RPC_URL),
  });
  publicClient = createPublicClient({
    chain,
    transport: http(env.CHAIN_RPC_URL),
  });
  walletAddress = account.address;
  nonceManager = await NonceManager.init(publicClient, walletAddress);
  logger.info({ walletAddress, nextNonce: nonceManager.peek().toString() }, "tx-submitter wallet loaded");
}

const routerAddress = env.PAYMENT_ROUTER_ADDRESS.toLowerCase() as `0x${string}`;
const routerConfigured = routerAddress !== zeroAddress;

async function start() {
  await initWallet();

  const worker = new Worker(
    "payment.submit",
    async (job) => {
      const { paymentId, payer, merchant, token, amount, nonce, deadline, signature } = job.data;
      logger.info(
        { jobId: job.id, paymentId, payer, merchant, token, amount },
        "processing payment job"
      );

      if (!routerConfigured || !walletClient || !nonceManager) {
        const reason = !routerConfigured
          ? "PAYMENT_ROUTER_ADDRESS unset"
          : "PRIVATE_KEY unset";
        logger.info({ reason, paymentId, jobId: job.id }, "stub mode: skipping settle() call");
        return { status: "stub", reason, paymentId, jobId: job.id };
      }

      try {
        const hash = await nonceManager.withNonce(async (managedNonce) => {
          return walletClient!.writeContract({
            account: walletClient!.account!,
            chain,
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
            nonce: Number(managedNonce),
          });
        });

        logger.info({ txHash: hash, paymentId, jobId: job.id }, "transaction submitted");
        return { status: "submitted", txHash: hash, paymentId };
      } catch (err) {
        logger.error({ err, jobId: job.id }, "failed to submit transaction");
        throw err; // let BullMQ retry; nonce manager has already reconciled
      }
    },
    {
      connection,
      // With the nonce manager serializing sends internally, we can let BullMQ
      // run a small concurrency. Keep it modest (2) — beyond that we'd want
      // a relayer pool, one EOA per lane.
      concurrency: 2,
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
}

start().catch((err) => {
  logger.error({ err }, "tx-submitter failed to start");
  process.exit(1);
});
