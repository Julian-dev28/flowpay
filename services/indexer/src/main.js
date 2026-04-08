"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const env_1 = require("./env");
const client = (0, viem_1.createPublicClient)({
    chain: chains_1.baseSepolia,
    transport: (0, viem_1.http)(env_1.env.RPC_URL),
});
// PaymentRouter ABI
const paymentRouterABI = (0, viem_1.parseAbi)([
    "event Settled(bytes32 indexed orderHash, address indexed merchant, address token, uint256 amount, uint256 nonce)",
]);
console.log(`FlowPay indexer started — watching Base Sepolia (chainId ${env_1.env.CHAIN_ID})`);
// Watch for Settled events
const unwatch = client.watchContractEvent({
    address: env_1.env.PAYMENT_ROUTER_ADDRESS,
    abi: paymentRouterABI,
    eventName: 'Settled',
    onLogs: (logs) => {
        for (const log of logs) {
            console.log('Settled event:', {
                orderHash: log.args.orderHash,
                merchant: log.args.merchant,
                token: log.args.token,
                amount: log.args.amount?.toString(),
                nonce: log.args.nonce?.toString(),
            });
        }
    },
});
console.log(`Watching PaymentRouter at ${env_1.env.PAYMENT_ROUTER_ADDRESS}`);
// Graceful shutdown
process.on("SIGINT", () => {
    console.log("Indexer shutting down");
    unwatch();
    process.exit(0);
});
