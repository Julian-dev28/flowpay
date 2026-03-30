import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { env } from "./env";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(env.RPC_URL),
});

console.log(`FlowPay indexer started — watching Base Sepolia (chainId ${env.CHAIN_ID})`);

// Skeleton: no block/event subscription yet
process.on("SIGINT", () => {
  console.log("Indexer shutting down");
  process.exit(0);
});
