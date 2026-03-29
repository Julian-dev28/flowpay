import { z } from "zod";

const envSchema = z.object({
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.string().default("6379"),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
