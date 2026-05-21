import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Defaults so the indexer starts without any .env file. Override in prod.
  RPC_URL: z.string().url().default("https://sepolia.base.org"),
  CHAIN_ID: z.coerce.number().default(84532), // Base Sepolia
  PAYMENT_ROUTER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x0000000000000000000000000000000000000000"),
  PORT: z.string().default("3002"),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  LOG_LEVEL: z.string().default("info"),
  // SQLite file. Defaults to a per-service .data dir; switch to an absolute
  // path or a network FS for prod.
  DATABASE_PATH: z.string().default("./.data/indexer.sqlite"),
  // Number of confirmations before an event is treated as final. On anvil
  // this can be 0; on Base/Base Sepolia 3–6 is the production default.
  CONFIRMATIONS: z.coerce.number().int().nonnegative().default(0),
  // Backfill safety net — if we have no cursor, start this many blocks back.
  BACKFILL_FROM_BLOCK: z.coerce.number().int().nonnegative().optional(),
});

export const env = envSchema.parse(process.env);
