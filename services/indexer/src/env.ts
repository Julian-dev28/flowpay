import { z } from "zod";

const envSchema = z.object({
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().default(84532), // Base Sepolia
});

export const env = envSchema.parse(process.env);
