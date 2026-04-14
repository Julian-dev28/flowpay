import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.string().default("6379"),
  CHAIN_RPC_URL: z.string().url().default("http://localhost:8545"),
  PAYMENT_ROUTER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x0000000000000000000000000000000000000000"),
  // Optional — when unset, the worker stays in stub mode and never sends a tx.
  // Never default to a real-looking but invalid key (e.g. 64 zeros) — it crashes secp256k1.
  PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
