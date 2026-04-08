import { z } from "zod";

const envSchema = z.object({
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().default(84532), // Base Sepolia
  PAYMENT_ROUTER_ADDRESS: z.string().default("0x0000000000000000000000000000000000000"),
});

export const env = envSchema.parse(process.env);
