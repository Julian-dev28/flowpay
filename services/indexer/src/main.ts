import Fastify from "fastify";
import cors from "@fastify/cors";
import pino from "pino";
import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  defineChain,
  type Chain,
  type Log,
} from "viem";
import { baseSepolia } from "viem/chains";
import { env } from "./env";
import { openDb, type IndexerDb, type SettledEventRow } from "./db";

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

const PAYMENT_ROUTER_ABI = parseAbi([
  "event Settled(bytes32 indexed orderHash, address indexed payer, address indexed merchant, address token, uint256 amount, uint256 nonce)",
]);
const SETTLED_EVENT = parseAbiItem(
  "event Settled(bytes32 indexed orderHash, address indexed payer, address indexed merchant, address token, uint256 amount, uint256 nonce)"
);

let db: IndexerDb;

function rowFromLog(log: Log<bigint, number, false, typeof SETTLED_EVENT>): SettledEventRow {
  const args = log.args as {
    orderHash: `0x${string}`;
    payer: `0x${string}`;
    merchant: `0x${string}`;
    token: `0x${string}`;
    amount: bigint;
    nonce: bigint;
  };
  return {
    order_hash: args.orderHash,
    payer: args.payer,
    merchant: args.merchant,
    token: args.token,
    amount: args.amount.toString(),
    nonce: args.nonce.toString(),
    tx_hash: log.transactionHash ?? "",
    block_number: (log.blockNumber ?? 0n).toString(),
    log_index: log.logIndex ?? 0,
    chain_id: env.CHAIN_ID,
    indexed_at: Date.now(),
  };
}

async function backfill(fromBlock: bigint, toBlock: bigint) {
  if (toBlock < fromBlock) return;
  logger.info({ fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, "backfill window");
  // viem getLogs handles ranges natively; for very wide ranges in production we'd
  // chunk by ~10k blocks per request.
  const CHUNK = 5000n;
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = cursor + CHUNK - 1n < toBlock ? cursor + CHUNK - 1n : toBlock;
    const logs = await client.getLogs({
      address: env.PAYMENT_ROUTER_ADDRESS as `0x${string}`,
      event: SETTLED_EVENT,
      fromBlock: cursor,
      toBlock: end,
    });
    if (logs.length) {
      for (const log of logs) db.insertEvent(rowFromLog(log));
      logger.info(
        { from: cursor.toString(), to: end.toString(), count: logs.length },
        "backfill chunk"
      );
    }
    db.setCursor(env.CHAIN_ID, end);
    cursor = end + 1n;
  }
}

async function main() {
  db = openDb(env.DATABASE_PATH);
  logger.info(
    {
      chain: chain.name,
      chainId: chain.id,
      rpc: env.RPC_URL,
      router: env.PAYMENT_ROUTER_ADDRESS,
      db: env.DATABASE_PATH,
      confirmations: env.CONFIRMATIONS,
    },
    "indexer starting"
  );

  // ── Resolve where to start indexing from
  const tip = await client.getBlockNumber();
  const cursor = db.getCursor(env.CHAIN_ID);
  let from: bigint;
  if (cursor != null) {
    from = cursor + 1n;
    logger.info({ from: from.toString(), tip: tip.toString() }, "resuming from cursor");
  } else if (env.BACKFILL_FROM_BLOCK !== undefined) {
    from = BigInt(env.BACKFILL_FROM_BLOCK);
    logger.info({ from: from.toString() }, "no cursor — backfill from configured block");
  } else {
    from = 0n;
    logger.info({ from: "0" }, "no cursor — backfilling from genesis (anvil-safe)");
  }

  await backfill(from, tip);

  // ── Live tail
  const unwatch = client.watchContractEvent({
    address: env.PAYMENT_ROUTER_ADDRESS as `0x${string}`,
    abi: PAYMENT_ROUTER_ABI,
    eventName: "Settled",
    onLogs: (logs) => {
      for (const log of logs) {
        const row = rowFromLog(log as Log<bigint, number, false, typeof SETTLED_EVENT>);
        db.insertEvent(row);
        if (log.blockNumber) db.setCursor(env.CHAIN_ID, log.blockNumber);
        logger.info({ event: row }, "Settled");
      }
    },
    onError: (err) => logger.error({ err }, "watchContractEvent error"),
  });

  // ── HTTP API
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
      eventsIndexed: db.countEvents(env.CHAIN_ID),
      cursor: db.getCursor(env.CHAIN_ID)?.toString() ?? null,
      confirmations: env.CONFIRMATIONS,
    };
  });

  app.get<{ Querystring: { limit?: string; payer?: string; merchant?: string } }>(
    "/events",
    async (request) => {
      const { limit, payer, merchant } = request.query;
      const n = Math.min(Math.max(Number.parseInt(limit ?? "50", 10) || 50, 1), 500);
      const rows = db.listEvents({
        chainId: env.CHAIN_ID,
        payer,
        merchant,
        limit: n,
      });
      const tip = await client.getBlockNumber().catch(() => null);

      const events = rows.map((r) => ({
        orderHash: r.order_hash,
        payer: r.payer,
        merchant: r.merchant,
        token: r.token,
        amount: r.amount,
        nonce: r.nonce,
        txHash: r.tx_hash,
        blockNumber: r.block_number,
        logIndex: r.log_index,
        indexedAt: r.indexed_at,
        confirmations: tip ? Number(tip - BigInt(r.block_number)) : null,
        final: tip ? Number(tip - BigInt(r.block_number)) >= env.CONFIRMATIONS : null,
      }));

      return { events, total: db.countEvents(env.CHAIN_ID) };
    }
  );

  app.get<{ Params: { payer: string; nonce: string } }>(
    "/events/by-nonce/:payer/:nonce",
    async (request, reply) => {
      const row = db.findByNonce(env.CHAIN_ID, request.params.payer, request.params.nonce);
      if (!row) return reply.code(404).send({ error: "not found" });
      const tip = await client.getBlockNumber().catch(() => null);
      return {
        orderHash: row.order_hash,
        payer: row.payer,
        merchant: row.merchant,
        token: row.token,
        amount: row.amount,
        nonce: row.nonce,
        txHash: row.tx_hash,
        blockNumber: row.block_number,
        indexedAt: row.indexed_at,
        confirmations: tip ? Number(tip - BigInt(row.block_number)) : null,
        final: tip ? Number(tip - BigInt(row.block_number)) >= env.CONFIRMATIONS : null,
      };
    }
  );

  await app.listen({ port: parseInt(env.PORT, 10), host: env.HOST });
  logger.info(`indexer HTTP on ${env.HOST}:${env.PORT}`);

  const shutdown = async () => {
    logger.info("indexer shutting down");
    unwatch();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "indexer failed");
  process.exit(1);
});
