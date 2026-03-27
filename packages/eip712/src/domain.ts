/**
 * EIP-712 domain separator for FlowPay PaymentRouter on Base Sepolia (chainId 84532).
 * The verifyingContract address is set at runtime from the deployed PaymentRouter.
 */
export interface EIP712Domain {
  name: "FlowPay";
  version: "1";
  chainId: 84532;
  verifyingContract: string;
}

export function getDomain(verifyingContract: string): EIP712Domain {
  return {
    name: "FlowPay",
    version: "1",
    chainId: 84532,
    verifyingContract,
  };
}
