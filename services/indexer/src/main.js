"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const env_1 = require("./env");
const client = (0, viem_1.createPublicClient)({
    chain: chains_1.baseSepolia,
    transport: (0, viem_1.http)(env_1.env.RPC_URL),
});
console.log(`FlowPay indexer started — watching Base Sepolia (chainId ${env_1.env.CHAIN_ID})`);
// Skeleton: no block/event subscription yet
process.on("SIGINT", () => {
    console.log("Indexer shutting down");
    process.exit(0);
});
