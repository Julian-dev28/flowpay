import { z } from "zod";

const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
// All on-chain integers go over the wire as decimal strings — they can exceed
// JavaScript's safe integer range, so JSON numbers won't survive round-trips.
const Uint256String = z.string().regex(/^\d+$/);

export const PayRequestSchema = z.object({
  payer: Address,
  merchant: Address,
  token: Address,
  amount: Uint256String,
  nonce: Uint256String,
  deadline: Uint256String,
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export type PayRequest = z.infer<typeof PayRequestSchema>;

export const QuoteRequestSchema = z.object({
  sellToken: Address,
  buyToken: Address,
  sellAmount: Uint256String,
});

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const FaucetRequestSchema = z.object({
  address: Address,
});
export type FaucetRequest = z.infer<typeof FaucetRequestSchema>;
