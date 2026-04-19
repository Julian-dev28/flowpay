/**
 * End-to-end demo driver.
 *
 * Assumes:
 *  - anvil is running on http://localhost:8545
 *  - contracts/script/DeployDemo.s.sol has been broadcast (run-latest.json
 *    is present), or the addresses below have been overridden via env.
 *  - The orchestrator is running on http://localhost:3001
 *
 * What it does:
 *  - Reads PaymentRouter + MockUSDC addresses from anvil broadcast or env.
 *  - As the demo payer (anvil #1), signs an EIP-712 PaymentOrder paying
 *    50 USDC to the merchant (anvil #2).
 *  - POSTs the signed order to /pay.
 *  - Polls the merchant's USDC balance until it ticks up.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  http,
  parseAbi,
  parseUnits,
  defineChain,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDomain, getTypedData } from "@flowpay/eip712";

const RPC_URL = process.env.RPC_URL ?? "http://localhost:8545";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:3001";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "31337");
const AMOUNT_USDC = process.env.AMOUNT_USDC ?? "50";

// anvil deterministic accounts
const PAYER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const MERCHANT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

function loadDeployedAddresses(): { router: Address; usdc: Address } {
  if (process.env.PAYMENT_ROUTER_ADDRESS && process.env.MOCK_USDC_ADDRESS) {
    return {
      router: process.env.PAYMENT_ROUTER_ADDRESS as Address,
      usdc: process.env.MOCK_USDC_ADDRESS as Address,
    };
  }
  const broadcastPath = resolve(
    __dirname,
    `../contracts/broadcast/DeployDemo.s.sol/${CHAIN_ID}/run-latest.json`
  );
  if (!existsSync(broadcastPath)) {
    throw new Error(
      `No broadcast log at ${broadcastPath}. Run:\n` +
        `  cd contracts && forge script script/DeployDemo.s.sol \\\n` +
        `    --rpc-url ${RPC_URL} \\\n` +
        `    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \\\n` +
        `    --broadcast\n` +
        `or pass PAYMENT_ROUTER_ADDRESS + MOCK_USDC_ADDRESS in the environment.`
    );
  }
  const log = JSON.parse(readFileSync(broadcastPath, "utf8"));
  let router: Address | undefined;
  let usdc: Address | undefined;
  for (const tx of log.transactions) {
    if (tx.contractName === "PaymentRouter") router = tx.contractAddress as Address;
    if (tx.contractName === "MockUSDC") usdc = tx.contractAddress as Address;
  }
  if (!router || !usdc) {
    throw new Error("PaymentRouter or MockUSDC missing from broadcast log");
  }
  return { router, usdc };
}

async function main() {
  const { router, usdc } = loadDeployedAddresses();
  const payer = privateKeyToAccount(PAYER_PK);

  const chain = defineChain({
    id: CHAIN_ID,
    name: `chain-${CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

  const usdcAbi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]);

  const decimals = await publicClient.readContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "decimals",
  });
  const amount = parseUnits(AMOUNT_USDC, decimals);

  const merchantBefore = await publicClient.readContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [MERCHANT],
  });

  const block = await publicClient.getBlock();
  const deadline = BigInt(block.timestamp) + 3600n;
  const nonce = BigInt(Date.now()); // ms-precision nonce, fine for a demo

  const typedData = getTypedData(getDomain(CHAIN_ID, router), {
    payer: payer.address,
    merchant: MERCHANT,
    token: usdc,
    amount,
    nonce,
    deadline,
  });

  const signature = await payer.signTypedData(typedData);

  console.log("Demo payment");
  console.log("  payer    :", payer.address);
  console.log("  merchant :", MERCHANT);
  console.log("  token    :", usdc);
  console.log("  amount   :", amount.toString(), `(${AMOUNT_USDC} USDC)`);
  console.log("  nonce    :", nonce.toString());
  console.log("  deadline :", deadline.toString());
  console.log("  router   :", router);
  console.log("  signature:", signature);

  const body = {
    payer: payer.address,
    merchant: MERCHANT,
    token: usdc,
    amount: amount.toString(),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature,
  };

  const res = await fetch(`${ORCHESTRATOR_URL}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { jobId?: string; paymentId?: string; error?: string };
  console.log("\nPOST /pay →", res.status, json);
  if (!res.ok) process.exit(1);

  // Poll merchant balance for ~30s.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const balance = await publicClient.readContract({
      address: usdc,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [MERCHANT],
    });
    if (balance > merchantBefore) {
      console.log(
        `\nmerchant balance ${merchantBefore} → ${balance}  (delta ${balance - merchantBefore})`
      );
      console.log("settled on-chain ✔");
      return;
    }
    if (i % 5 === 4) console.log(`  …waiting (${i + 1}s) merchant balance still ${balance}`);
  }
  console.error("\ntimed out: merchant balance did not increase");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
