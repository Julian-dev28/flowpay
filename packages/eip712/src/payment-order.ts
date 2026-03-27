/**
 * PaymentOrder matches the Solidity struct in PaymentRouter.sol.
 * Used for EIP-712 signing in the dApp and recovery in the contract.
 */
export interface PaymentOrder {
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  deadline: number;
}

export const PAYMENT_ORDER_TYPE = {
  PaymentOrder: [
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Returns the full typed data structure for wagmi/viem signTypedData.
 */
export function getTypedData(
  domain: { name: string; version: string; chainId: number; verifyingContract: string },
  order: PaymentOrder
) {
  return {
    domain,
    types: PAYMENT_ORDER_TYPE,
    primaryType: "PaymentOrder" as const,
    message: order,
  };
}
