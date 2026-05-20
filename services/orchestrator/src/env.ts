import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3001"),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  PROMETHEUS_ENABLED: z.string().default("true"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  // Comma-separated list of allowed CORS origins, or `*` for any (dev only).
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),

  // ─── faucet (dev only) ────────────────────────────────────────────────────
  // POST /faucet sends ETH + mints MockUSDC to any address on the configured
  // chain. Disabled unless FAUCET_ENABLED=true; intended for local anvil.
  FAUCET_ENABLED: z.string().default("false"),
  FAUCET_RPC_URL: z.string().url().default("http://localhost:8545"),
  FAUCET_CHAIN_ID: z.coerce.number().int().positive().default(31337),
  FAUCET_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  FAUCET_TOKEN_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  FAUCET_ETH_DROP: z.string().default("0.5"), // ETH per request
  FAUCET_TOKEN_DROP: z.string().default("1000"), // tokens per request (in base units of token decimals)
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
