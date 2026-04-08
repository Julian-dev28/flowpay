"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    RPC_URL: zod_1.z.string().url(),
    CHAIN_ID: zod_1.z.coerce.number().default(84532), // Base Sepolia
    PAYMENT_ROUTER_ADDRESS: zod_1.z.string().default("0x0000000000000000000000000000000000000"),
});
exports.env = envSchema.parse(process.env);
