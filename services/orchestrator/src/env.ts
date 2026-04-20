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
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
