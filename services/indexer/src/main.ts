import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { env } from "./env";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(env.RPC_URL),
});

// In-memory store for Settled events (extend to DB later)
const settledEvents: Array<{
  orderHash: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  timestamp: number;
}> = [];

// PaymentRouter ABI
const paymentRouterABI = parseAbi([
  "event Settled(bytes32 indexed orderHash, address indexed merchant, address token, uint256 amount, uint256 nonce)",
]);

console.log(`FlowPay indexer started — watching Base Sepolia (chainId ${env.CHAIN_ID})`);

// Watch for Settled events
const unwatch = client.watchContractEvent({
  address: env.PAYMENT_ROUTER_ADDRESS as `0x${string}`,
  abi: paymentRouterABI,
  eventName: 'Settled',
  onLogs: (logs) => {
    for (const log of logs) {
      const event = {
        orderHash: log.args.orderHash as string,
        merchant: log.args.merchant as string,
        token: log.args.token as string,
        amount: log.args.amount?.toString() || "",
        nonce: log.args.nonce?.toString() || "",
        timestamp: Date.now(),
      };
      settledEvents.push(event);
      console.log('Settled event saved:', event);
    }
  },
});

console.log(`Watching PaymentRouter at ${env.PAYMENT_ROUTER_ADDRESS}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Indexer shutting down");
  unwatch();
  process.exit(0);
});
