"use client";

import { useState, useMemo } from "react";
import { useAccount, useConnect, useDisconnect, useSignTypedData, useChainId } from "wagmi";
import { parseUnits, type Address, type Hex } from "viem";

const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:3001";

// Anvil-friendly defaults so the demo works immediately after running
// `forge script DeployDemo.s.sol` from docs/DEMO.md.
const DEFAULTS = {
  router: "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address,
  token: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address, // MockUSDC
  merchant: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address, // anvil #2
  decimals: 6,
};

const PAYMENT_ORDER_TYPES = {
  PaymentOrder: [
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

function short(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Home() {
  const { isConnected, address } = useAccount();
  const { connectors, connect, status: connectStatus, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();

  const [merchant, setMerchant] = useState<string>(DEFAULTS.merchant);
  const [token, setToken] = useState<string>(DEFAULTS.token);
  const [router, setRouter] = useState<string>(DEFAULTS.router);
  const [amountStr, setAmountStr] = useState<string>("50");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const canSubmit = useMemo(() => {
    return (
      isConnected &&
      /^0x[a-fA-F0-9]{40}$/.test(merchant) &&
      /^0x[a-fA-F0-9]{40}$/.test(token) &&
      /^0x[a-fA-F0-9]{40}$/.test(router) &&
      /^\d+(\.\d+)?$/.test(amountStr) &&
      !busy
    );
  }, [isConnected, merchant, token, router, amountStr, busy]);

  async function handlePay() {
    if (!address) return;
    setBusy(true);
    setResult(null);
    try {
      const amount = parseUnits(amountStr, DEFAULTS.decimals);
      const nonce = BigInt(Date.now());
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const signature: Hex = await signTypedDataAsync({
        domain: {
          name: "PaymentRouter",
          version: "1",
          chainId,
          verifyingContract: router as Address,
        },
        types: PAYMENT_ORDER_TYPES,
        primaryType: "PaymentOrder",
        message: {
          payer: address,
          merchant: merchant as Address,
          token: token as Address,
          amount,
          nonce,
          deadline,
        },
      });

      const body = {
        payer: address,
        merchant,
        token,
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
      const json = await res.json();
      setResult({
        ok: res.ok,
        text: `POST /pay → ${res.status}\n${JSON.stringify(json, null, 2)}\n\nSigned order:\n${JSON.stringify(body, null, 2)}`,
      });
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          <div className="brand-mark" />
          FlowPay
        </div>
        <div className="nav-links">
          <a
            href="https://github.com/anthropics/claude-code"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a href="#demo">Demo</a>
          <a href="#stack">Stack</a>
        </div>
      </nav>

      <header className="hero">
        <div className="eyebrow">
          <span className="dot" />
          live on Base Sepolia · anvil-ready
        </div>
        <h1>
          EIP-712 signed payments on{" "}
          <span className="accent">Base</span>.
        </h1>
        <p>
          Payers sign a typed payment intent off-chain. A relayer settles it
          on-chain through <span className="mono">PaymentRouter.settle()</span>,
          which pushes the funds directly from the payer's wallet to the
          merchant — the router never holds balance.
        </p>
        <div className="hero-cta">
          {!isConnected ? (
            connectors.map((connector) => (
              <button
                key={connector.id}
                className="btn"
                onClick={() => connect({ connector })}
                disabled={connectStatus === "pending"}
              >
                {connectStatus === "pending"
                  ? "Connecting…"
                  : `Connect ${connector.name}`}
              </button>
            ))
          ) : (
            <>
              <span className="chip success">
                <span className="dot" style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />
                connected · {short(address)}
              </span>
              <span className="chip">chain id {chainId}</span>
              <button className="btn ghost" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          )}
        </div>
        {connectError && (
          <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 13 }}>
            {connectError.message}
          </p>
        )}
      </header>

      <section id="demo" className="grid">
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Try a payment</h2>
              <p className="card-sub">
                Sign a PaymentOrder and POST it to <span className="mono">/pay</span>.
                The orchestrator validates, enqueues, and the tx-submitter
                settles on-chain.
              </p>
            </div>
            <span className="chip">localhost:3001</span>
          </div>

          <div className="field">
            <label>Payer (you)</label>
            <input
              value={address ?? ""}
              readOnly
              placeholder="connect a wallet"
            />
          </div>

          <div className="field">
            <label>Merchant address</label>
            <input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="0x…"
            />
          </div>

          <div className="field">
            <label>Token (ERC-20)</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="0x…"
            />
          </div>

          <div className="field">
            <label>PaymentRouter address</label>
            <input
              value={router}
              onChange={(e) => setRouter(e.target.value)}
              placeholder="0x…"
            />
          </div>

          <div className="field">
            <label>Amount (token units, 6 decimals)</label>
            <input
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="50"
            />
          </div>

          <button
            className="btn full"
            onClick={handlePay}
            disabled={!canSubmit || isSigning}
          >
            {!isConnected
              ? "Connect a wallet to sign"
              : isSigning
                ? "Sign in wallet…"
                : busy
                  ? "Submitting…"
                  : `Sign & pay ${amountStr || "0"} tokens`}
          </button>

          {result && (
            <pre className={`result ${result.ok ? "success" : "error"}`}>
              {result.text}
            </pre>
          )}
        </div>

        <aside>
          <div className="card">
            <h3>How a payment flows</h3>
            <div className="kv">
              <span className="k">1. sign</span>
              <span className="v">wallet → EIP-712 PaymentOrder</span>
            </div>
            <div className="kv">
              <span className="k">2. POST</span>
              <span className="v">/pay → orchestrator (Fastify 5)</span>
            </div>
            <div className="kv">
              <span className="k">3. enqueue</span>
              <span className="v">BullMQ payment.submit</span>
            </div>
            <div className="kv">
              <span className="k">4. settle</span>
              <span className="v">tx-submitter calls PaymentRouter</span>
            </div>
            <div className="kv">
              <span className="k">5. index</span>
              <span className="v">viem watcher logs Settled</span>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }} id="stack">
            <h3>Stack</h3>
            <div className="stack">
              <span className="chip">Solidity 0.8.26</span>
              <span className="chip">OpenZeppelin v5</span>
              <span className="chip">Foundry</span>
              <span className="chip">Fastify 5</span>
              <span className="chip">BullMQ 5</span>
              <span className="chip">viem 2</span>
              <span className="chip">Next.js 15</span>
              <span className="chip">wagmi 2</span>
              <span className="chip">TanStack Query</span>
            </div>
            <p className="card-sub" style={{ marginTop: 14 }}>
              10/10 forge tests · 100% PaymentRouter coverage · CI on every
              PR · end-to-end demo in <span className="mono">docs/DEMO.md</span>.
            </p>
          </div>
        </aside>
      </section>

      <footer>
        FlowPay · built with Claude Code · MIT
      </footer>
    </div>
  );
}
