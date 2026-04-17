/**
 * EIP-712 domain for FlowPay's PaymentRouter.
 *
 * Domain name + version are pinned by the on-chain contract constants
 * (NAME = "PaymentRouter", VERSION = "1"). chainId and verifyingContract are
 * supplied at runtime so the same builder works against anvil, Base Sepolia,
 * and Base mainnet.
 */
export interface EIP712Domain {
  name: "PaymentRouter";
  version: "1";
  chainId: number;
  verifyingContract: string;
}

export function getDomain(chainId: number, verifyingContract: string): EIP712Domain {
  return {
    name: "PaymentRouter",
    version: "1",
    chainId,
    verifyingContract,
  };
}
