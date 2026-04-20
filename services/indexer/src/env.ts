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
});

export const env = envSchema.parse(process.env);
