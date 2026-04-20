import Fastify from "fastify";
import cors from "@fastify/cors";
import pino from "pino";
import {
  createPublicClient,
  http,
  parseAbi,
  defineChain,
  type Chain,
} from "viem";
import { baseSepolia } from "viem/chains";
import { env } from "./env";

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "indexer" },
});

function resolveChain(chainId: number, rpcUrl: string): Chain {
  if (chainId === baseSepolia.id) return baseSepolia;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

const chain = resolveChain(env.CHAIN_ID, env.RPC_URL);
const client = createPublicClient({
  chain,
  transport: http(env.RPC_URL),
});

type SettledEvent = {
  orderHash: string;
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  txHash: string;
  blockNumber: string;
  timestamp: number;
};

// In-memory ring buffer. Production swaps this for Postgres / Clickhouse.
const MAX_EVENTS = 500;
const settledEvents: SettledEvent[] = [];

const paymentRouterABI = parseAbi([
  "event Settled(bytes32 indexed orderHash, address indexed payer, address indexed merchant, address token, uint256 amount, uint256 nonce)",
]);

logger.info(
  { chain: chain.name, chainId: chain.id, rpc: env.RPC_URL, router: env.PAYMENT_ROUTER_ADDRESS },
  "indexer starting"
);

const unwatch = client.watchContractEvent({
  address: env.PAYMENT_ROUTER_ADDRESS as `0x${string}`,
  abi: paymentRouterABI,
  eventName: "Settled",
  onLogs: (logs) => {
    for (const log of logs) {
      const event: SettledEvent = {
        orderHash: log.args.orderHash as string,
        payer: log.args.payer as string,
        merchant: log.args.merchant as string,
        token: log.args.token as string,
        amount: log.args.amount?.toString() ?? "",
        nonce: log.args.nonce?.toString() ?? "",
        txHash: log.transactionHash ?? "",
        blockNumber: log.blockNumber?.toString() ?? "",
        timestamp: Date.now(),
      };
      settledEvents.unshift(event);
      if (settledEvents.length > MAX_EVENTS) settledEvents.length = MAX_EVENTS;
      logger.info({ event }, "Settled");
    }
  },
});

// ───── HTTP API ─────────────────────────────────────────────────────────────
const app = Fastify({ logger: { level: env.LOG_LEVEL } });

const allowedOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.register(cors, {
  origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  methods: ["GET", "OPTIONS"],
});

app.get("/healthz", async () => {
  const blockNumber = await client.getBlockNumber().catch(() => null);
  return {
    status: blockNumber == null ? "degraded" : "ok",
    chainId: chain.id,
    chainName: chain.name,
    rpcUrl: env.RPC_URL,
    paymentRouter: env.PAYMENT_ROUTER_ADDRESS,
    blockNumber: blockNumber?.toString() ?? null,
    eventsBuffered: settledEvents.length,
  };
});

app.get<{ Querystring: { limit?: string; payer?: string; merchant?: string } }>(
  "/events",
  async (request) => {
    const { limit, payer, merchant } = request.query;
    let out = settledEvents;
    if (payer) {
      const p = payer.toLowerCase();
      out = out.filter((e) => e.payer.toLowerCase() === p);
    }
    if (merchant) {
      const m = merchant.toLowerCase();
      out = out.filter((e) => e.merchant.toLowerCase() === m);
    }
    const n = Math.min(Math.max(Number.parseInt(limit ?? "50", 10) || 50, 1), MAX_EVENTS);
    return { events: out.slice(0, n), total: settledEvents.length };
  }
);

app.listen({ port: parseInt(env.PORT, 10), host: env.HOST }).then(
  () => logger.info(`indexer HTTP on ${env.HOST}:${env.PORT}`),
  (err) => {
    logger.error({ err }, "indexer HTTP failed to start");
    process.exit(1);
  }
);

const shutdown = async () => {
  logger.info("indexer shutting down");
  unwatch();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
