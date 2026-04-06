import { z } from "zod";

const envSchema = z.object({
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.string().default("6379"),
  CHAIN_RPC_URL: z.string().url().default("http://localhost:8545"),
  PAYMENT_ROUTER_ADDRESS: z.string().default("0x0000000000000000000000000000000000000000"),
  PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).default("0x" + "0".repeat(64)),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
