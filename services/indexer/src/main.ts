import { createPublicClient, http, parseAbi, defineChain, type Chain } from "viem";
import { baseSepolia } from "viem/chains";
import { env } from "./env";

function resolveChain(chainId: number, rpcUrl: string): Chain {
  if (chainId === baseSepolia.id) return baseSepolia;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

const chain = resolveChain(env.CHAIN_ID, env.RPC_URL);
const client = createPublicClient({
  chain,
  transport: http(env.RPC_URL),
});

// In-memory store for Settled events (extend to DB later).
const settledEvents: Array<{
  orderHash: string;
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  timestamp: number;
}> = [];

// Keep in sync with contracts/src/PaymentRouter.sol.
const paymentRouterABI = parseAbi([
  "event Settled(bytes32 indexed orderHash, address indexed payer, address indexed merchant, address token, uint256 amount, uint256 nonce)",
]);

console.log(`FlowPay indexer started — chain ${chain.name} (id ${chain.id}), rpc ${env.RPC_URL}`);

const unwatch = client.watchContractEvent({
  address: env.PAYMENT_ROUTER_ADDRESS as `0x${string}`,
  abi: paymentRouterABI,
  eventName: "Settled",
  onLogs: (logs) => {
    for (const log of logs) {
      const event = {
        orderHash: log.args.orderHash as string,
        payer: log.args.payer as string,
        merchant: log.args.merchant as string,
        token: log.args.token as string,
        amount: log.args.amount?.toString() ?? "",
        nonce: log.args.nonce?.toString() ?? "",
        timestamp: Date.now(),
      };
      settledEvents.push(event);
      console.log("Settled event saved:", event);
    }
  },
});

console.log(`Watching PaymentRouter at ${env.PAYMENT_ROUTER_ADDRESS}`);

process.on("SIGINT", () => {
  console.log("Indexer shutting down");
  unwatch();
  process.exit(0);
});
