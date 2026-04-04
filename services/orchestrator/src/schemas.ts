import { z } from "zod";

export const PayRequestSchema = z.object({
  merchant: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/),
  nonce: z.number().int().nonnegative(),
  deadline: z.number().int().positive(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export type PayRequest = z.infer<typeof PayRequestSchema>;
