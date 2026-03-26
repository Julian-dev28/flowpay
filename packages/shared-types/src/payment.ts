import { z } from "zod";

/**
 * Payment lifecycle states.
 *
 * State machine transitions:
 * pending  --(quote received)--> quoted
 * quoted   --(user signed)-->   signed
 * signed   --(tx submitted)->   submitted
 * submitted --(Settled event)-> confirmed
 * any      --(error/revert)--> failed
 */
export const PaymentStatus = z.enum([
  "pending",
  "quoted",
  "signed",
  "submitted",
  "confirmed",
  "failed",
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/**
 * A quote returned by the 0x Swap API v2, persisted on the payment row.
 * Only the fields the orchestrator needs are retained.
 */
export const QuoteSchema = z.object({
  chainId: z.number(),
  sellToken: z.string(),
  buyToken: z.string(),
  sellAmount: z.string(),
  buyAmount: z.string(),
  allowanceTarget: z.string(),
  to: z.string(),
  data: z.string(),
  value: z.string(),
  gas: z.string().optional(),
  price: z.string().optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;

/**
 * PaymentIntent represents a user's intent to pay.
 * Created on POST /payments, updated as the lifecycle progresses.
 */
export const PaymentIntentSchema = z.object({
  id: z.string().uuid(),
  status: PaymentStatus,
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  merchant: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/),
  quote: QuoteSchema.optional(),
  signature: z.string().optional(),
  txHash: z.string().optional(),
  idempotencyKey: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;
