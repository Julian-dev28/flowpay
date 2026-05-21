"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  useAccount,
  useChainId,
  useSignTypedData,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useBlockNumber,
} from "wagmi";
import { foundry, baseSepolia, base } from "wagmi/chains";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseUnits, formatUnits, erc20Abi, maxUint256, type Address, type Hex } from "viem";

const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:3001";
const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3002";

const SUPPORTED: Record<number, { name: string; explorer?: string }> = {
  [foundry.id]: { name: "Anvil" },
  [baseSepolia.id]: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
  [base.id]: { name: "Base", explorer: "https://basescan.org" },
};

// PaymentRouter is anvil-only in this demo; the EIP-712 domain separator
// includes chainId, so signing against any other chain → InvalidSignature.
const TARGET_CHAIN_ID = foundry.id;

// Deterministic anvil addresses from `forge script DeployDemo.s.sol`.
const DEFAULTS = {
  router: "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address,
  token: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address,
  merchant: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
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

// ── Types ───────────────────────────────────────────────────────────────────
type Phase =
  | { stage: "idle" }
  | { stage: "signing" }
  | { stage: "queued"; paymentId: string; jobId?: string; nonce: bigint }
  | { stage: "submitting"; paymentId: string; jobId?: string; nonce: bigint }
  | { stage: "submitted"; paymentId: string; jobId?: string; nonce: bigint; txHash: string }
  | {
      stage: "settled";
      paymentId: string;
      jobId?: string;
      nonce: bigint;
      txHash: string;
      blockNumber: string;
      confirmations: number | null;
    }
  | { stage: "failed"; reason: string; paymentId?: string };

type IntentRow = {
  id: string;
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  deadline: string;
  status: "queued" | "submitting" | "submitted" | "settled" | "failed";
  jobId: string | null;
  txHash: string | null;
  failureReason: string | null;
  createdAt: number;
  updatedAt: number;
};

type SettledEvent = {
  orderHash: string;
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  indexedAt: number;
  confirmations: number | null;
  final: boolean | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function short(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relTime(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function Addr({ value, explorer }: { value?: string; explorer?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center" }}>
      {explorer ? (
        <a
          className="ext-link"
          href={`${explorer}/address/${value}`}
          target="_blank"
          rel="noreferrer"
        >
          {short(value)}
        </a>
      ) : (
        <span>{short(value)}</span>
      )}
      <button className="copy" onClick={onCopy} title="copy">
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

function statusChipClass(status: IntentRow["status"]) {
  switch (status) {
    case "settled":
      return "chip success";
    case "failed":
      return "chip danger";
    case "submitted":
    case "submitting":
      return "chip warning";
    default:
      return "chip";
  }
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Home() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();
  const { writeContractAsync, isPending: isApproving } = useWriteContract();

  const knownChain = SUPPORTED[chainId];
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID;

  const [merchant, setMerchant] = useState<string>(DEFAULTS.merchant);
  const [token, setToken] = useState<string>(DEFAULTS.token);
  const [router, setRouter] = useState<string>(DEFAULTS.router);
  const [amountStr, setAmountStr] = useState<string>("50");

  const [phase, setPhase] = useState<Phase>({ stage: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SettledEvent[]>([]);
  const [history, setHistory] = useState<IntentRow[]>([]);
  const [orchestratorOnline, setOrchestratorOnline] = useState<boolean | null>(null);
  const [indexerOnline, setIndexerOnline] = useState<boolean | null>(null);
  const [faucet, setFaucet] = useState<{ enabled: boolean; ethDrop?: string; tokenDrop?: string } | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);

  const { data: blockNumber } = useBlockNumber({
    watch: !wrongNetwork && isConnected,
    query: { refetchInterval: 3000 },
  });

  // ── ERC-20 reads
  const tokenValid = /^0x[a-fA-F0-9]{40}$/.test(token);
  const merchantValid = /^0x[a-fA-F0-9]{40}$/.test(merchant);
  const routerValid = /^0x[a-fA-F0-9]{40}$/.test(router);

  const { data: tokenDecimals } = useReadContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: tokenValid && !wrongNetwork },
  });
  const { data: tokenSymbol } = useReadContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: tokenValid && !wrongNetwork },
  });
  const { data: payerBalance, refetch: refetchPayer } = useReadContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && tokenValid && !wrongNetwork, refetchInterval: 4000 },
  });
  const { data: merchantBalance, refetch: refetchMerchant } = useReadContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: merchantValid ? [merchant as Address] : undefined,
    query: {
      enabled: tokenValid && merchantValid && !wrongNetwork,
      refetchInterval: 4000,
    },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && routerValid ? [address, router as Address] : undefined,
    query: {
      enabled: !!address && tokenValid && routerValid && !wrongNetwork,
      refetchInterval: 4000,
    },
  });

  const decimals = (tokenDecimals as number | undefined) ?? 6;
  const symbol = (tokenSymbol as string | undefined) ?? "TOKEN";

  const parsedAmount = useMemo(() => {
    try {
      return /^\d+(\.\d+)?$/.test(amountStr) ? parseUnits(amountStr, decimals) : null;
    } catch {
      return null;
    }
  }, [amountStr, decimals]);

  const needsApproval =
    parsedAmount != null && allowance != null && (allowance as bigint) < parsedAmount;
  const insufficientBalance =
    parsedAmount != null && payerBalance != null && (payerBalance as bigint) < parsedAmount;

  // ── Health pings
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const res = await fetch(`${ORCHESTRATOR_URL}/healthz`, { cache: "no-store" });
        if (!cancelled) setOrchestratorOnline(res.ok);
      } catch {
        if (!cancelled) setOrchestratorOnline(false);
      }
      try {
        const res = await fetch(`${INDEXER_URL}/healthz`, { cache: "no-store" });
        if (!cancelled) setIndexerOnline(res.ok);
      } catch {
        if (!cancelled) setIndexerOnline(false);
      }
      try {
        const res = await fetch(`${ORCHESTRATOR_URL}/faucet`, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const j = await res.json();
          setFaucet(j);
        }
      } catch {
        /* faucet may be disabled */
      }
    }
    probe();
    const t = setInterval(probe, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // ── Activity feed (global) ────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch(`${INDEXER_URL}/events?limit=20`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { events: SettledEvent[] };
      setEvents(json.events ?? []);
    } catch {
      /* keep last known state */
    }
  }, []);
  useEffect(() => {
    loadEvents();
    const t = setInterval(loadEvents, 4000);
    return () => clearInterval(t);
  }, [loadEvents]);

  // ── Per-wallet history (orchestrator's intent table) ─────────────────────
  const loadHistory = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(
        `${ORCHESTRATOR_URL}/payments?payer=${address}&limit=20`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const json = (await res.json()) as { payments: IntentRow[] };
      setHistory(json.payments ?? []);
    } catch {
      /* keep last known state */
    }
  }, [address]);
  useEffect(() => {
    loadHistory();
    const t = setInterval(loadHistory, 4000);
    return () => clearInterval(t);
  }, [loadHistory]);

  // ── Lifecycle: drive phase from orchestrator + indexer ───────────────────
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const active =
      phase.stage === "queued" ||
      phase.stage === "submitting" ||
      phase.stage === "submitted";
    if (!active) return;
    const paymentId = phase.paymentId;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`${ORCHESTRATOR_URL}/payments/${paymentId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const intent = (await res.json()) as IntentRow;
        if (cancelled) return;
        if (intent.status === "failed") {
          setPhase({
            stage: "failed",
            reason: intent.failureReason ?? "unknown failure",
            paymentId,
          });
          return;
        }
        // Pull tx info / confirmations from the indexer once we have a tx.
        if (intent.status === "settled" && intent.txHash) {
          const ev = await fetch(
            `${INDEXER_URL}/events/by-nonce/${intent.payer}/${intent.nonce}`,
            { cache: "no-store" }
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          setPhase({
            stage: "settled",
            paymentId,
            jobId: intent.jobId ?? undefined,
            nonce: BigInt(intent.nonce),
            txHash: intent.txHash,
            blockNumber: ev?.blockNumber ?? "—",
            confirmations: ev?.confirmations ?? null,
          });
          refetchPayer();
          refetchMerchant();
          loadHistory();
          loadEvents();
          return;
        }
        if (intent.status === "submitted" && intent.txHash) {
          setPhase({
            stage: "submitted",
            paymentId,
            jobId: intent.jobId ?? undefined,
            nonce: BigInt(intent.nonce),
            txHash: intent.txHash,
          });
          return;
        }
        if (intent.status === "submitting") {
          setPhase((prev) =>
            prev.stage === "queued"
              ? {
                  stage: "submitting",
                  paymentId,
                  jobId: intent.jobId ?? undefined,
                  nonce: BigInt(intent.nonce),
                }
              : prev
          );
          return;
        }
      } catch {
        /* transient — keep state */
      }
    }
    tick();
    const t = setInterval(tick, 1200);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [phase, loadHistory, loadEvents, refetchPayer, refetchMerchant]);

  // ── Approval flow ─────────────────────────────────────────────────────────
  const [approveHash, setApproveHash] = useState<Hex | null>(null);
  const { isLoading: isApprovingTx, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash ?? undefined,
  });
  useEffect(() => {
    if (approveConfirmed) refetchAllowance();
  }, [approveConfirmed, refetchAllowance]);

  async function handleApprove() {
    if (!address || !routerValid || !tokenValid) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: token as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [router as Address, maxUint256],
      });
      setApproveHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFaucet() {
    if (!address) return;
    setFaucetBusy(true);
    setError(null);
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const j = await res.json();
      if (!res.ok) setError(`faucet: ${j.error ?? res.status}`);
      else {
        setTimeout(() => refetchPayer(), 800);
        setTimeout(() => refetchPayer(), 2400);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFaucetBusy(false);
    }
  }

  // ── Pay flow (sign → POST /pay with Idempotency-Key) ─────────────────────
  async function handlePay() {
    if (!address || parsedAmount == null) return;
    setError(null);
    setPhase({ stage: "signing" });
    try {
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
          amount: parsedAmount,
          nonce,
          deadline,
        },
      });

      const body = {
        payer: address,
        merchant,
        token,
        amount: parsedAmount.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature,
      };

      // Idempotency key — a retry from a flaky network will dedup server-side.
      const idemKey = crypto.randomUUID();

      const res = await fetch(`${ORCHESTRATOR_URL}/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhase({ stage: "failed", reason: json?.error ?? `HTTP ${res.status}` });
        return;
      }
      setPhase({
        stage: "queued",
        paymentId: String(json.paymentId),
        jobId: json.jobId ? String(json.jobId) : undefined,
        nonce,
      });
      loadHistory();
    } catch (err) {
      setPhase({
        stage: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function resetFlow() {
    setPhase({ stage: "idle" });
    setError(null);
  }

  // ── Derived UI ────────────────────────────────────────────────────────────
  const explorer = knownChain?.explorer;
  const failed = phase.stage === "failed";

  // Off-chain vs on-chain step status
  const offChainSteps: Array<{ key: string; label: string; status: "pending" | "active" | "done" | "failed"; meta?: string }> = [
    {
      key: "sign",
      label: "Wallet signature (EIP-712)",
      status:
        phase.stage === "idle"
          ? "pending"
          : phase.stage === "signing"
            ? "active"
            : phase.stage === "failed" && !("paymentId" in phase && phase.paymentId)
              ? "failed"
              : "done",
    },
    {
      key: "submit",
      label: "Orchestrator validates + enqueues",
      status:
        phase.stage === "queued"
          ? "active"
          : phase.stage === "submitting" ||
              phase.stage === "submitted" ||
              phase.stage === "settled"
            ? "done"
            : phase.stage === "failed" && "paymentId" in phase && phase.paymentId
              ? "failed"
              : "pending",
      meta:
        "paymentId" in phase && phase.paymentId
          ? `id ${short(phase.paymentId)}`
          : undefined,
    },
    {
      key: "pickup",
      label: "Relayer picks up the job",
      status:
        phase.stage === "submitting"
          ? "active"
          : phase.stage === "submitted" || phase.stage === "settled"
            ? "done"
            : "pending",
    },
  ];

  const onChainSteps: Array<{ key: string; label: string; status: "pending" | "active" | "done"; meta?: string }> = [
    {
      key: "broadcast",
      label: "settle() broadcast",
      status:
        phase.stage === "submitted"
          ? "active"
          : phase.stage === "settled"
            ? "done"
            : "pending",
      meta:
        (phase.stage === "submitted" || phase.stage === "settled") && phase.txHash
          ? short(phase.txHash)
          : undefined,
    },
    {
      key: "indexed",
      label: "Indexed (Settled event)",
      status: phase.stage === "settled" ? "done" : "pending",
      meta:
        phase.stage === "settled"
          ? `block #${phase.blockNumber}${
              phase.confirmations != null ? ` · ${phase.confirmations} conf` : ""
            }`
          : undefined,
    },
  ];

  return (
    <div className="shell">
      {/* ── nav ───────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="brand">
          <div className="brand-mark" />
          FlowPay
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            className={`status-pill ${orchestratorOnline ? "online" : orchestratorOnline === false ? "offline" : ""}`}
            title={`${ORCHESTRATOR_URL}/healthz`}
          >
            <span className="dot" />
            orchestrator
          </span>
          <span
            className={`status-pill ${indexerOnline ? "online" : indexerOnline === false ? "offline" : ""}`}
            title={`${INDEXER_URL}/healthz`}
          >
            <span className="dot" />
            indexer
          </span>
          {blockNumber != null && !wrongNetwork && (
            <span className="status-pill online" title="latest block">
              <span className="dot" />
              block #{blockNumber.toString()}
            </span>
          )}
          <ConnectButton
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus={{ smallScreen: "icon", largeScreen: "full" }}
            showBalance={{ smallScreen: false, largeScreen: true }}
          />
        </div>
      </nav>

      {/* ── hero ──────────────────────────────────────────────────────── */}
      <header className="hero">
        <div className="eyebrow">
          <span className="dot" />
          {knownChain ? `live · ${knownChain.name}` : "live · multi-chain"}
        </div>
        <h1>
          EIP-712 signed payments on <span className="accent">Base</span>.
        </h1>
        <p>
          Payers sign a typed payment intent off-chain. A relayer settles it
          on-chain through <span className="mono">PaymentRouter.settle()</span>,
          which pushes funds directly from the payer to the merchant — the
          router never holds balance. Every intent is persisted, idempotent on
          retry, and reconciled against the on-chain index.
        </p>
        {wrongNetwork && (
          <div className="result error" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>
                This demo runs on local anvil (chain id {TARGET_CHAIN_ID}).
                Your wallet is on chain {chainId} — signatures from any other
                chain will be rejected by the router as <span className="mono">InvalidSignature</span>.
              </span>
              <button
                className="btn ghost"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
                style={{ padding: "6px 12px", whiteSpace: "nowrap" }}
              >
                {isSwitching ? "Switching…" : "Switch to Anvil"}
              </button>
            </div>
          </div>
        )}
      </header>

      <section id="demo" className="grid">
        {/* ── compose ─────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Compose payment</h2>
              <p className="card-sub">
                Approve once, sign each PaymentOrder, the relayer takes care
                of the on-chain settle.
              </p>
            </div>
          </div>

          <div className="field">
            <label>Payer (you)</label>
            <input value={address ?? ""} readOnly placeholder="connect a wallet to begin" />
            {address && payerBalance != null && (
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                balance: <strong style={{ color: "var(--text)" }}>{formatUnits(payerBalance as bigint, decimals)}</strong> {symbol}
                {allowance != null && (
                  <>
                    {" · "}router allowance:{" "}
                    <strong style={{ color: "var(--text)" }}>
                      {allowance === maxUint256 ? "unlimited" : formatUnits(allowance as bigint, decimals)}
                    </strong>{" "}
                    {symbol}
                  </>
                )}
              </span>
            )}
            {address &&
              !wrongNetwork &&
              faucet?.enabled &&
              insufficientBalance && (
                <button
                  className="btn ghost"
                  onClick={handleFaucet}
                  disabled={faucetBusy}
                  style={{ marginTop: 8, alignSelf: "flex-start", padding: "6px 12px", fontSize: 12 }}
                >
                  {faucetBusy
                    ? "Funding…"
                    : `Fund my wallet (${faucet.tokenDrop} ${symbol} + ${faucet.ethDrop} ETH)`}
                </button>
              )}
          </div>

          <div className="field">
            <label>Merchant</label>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x…" />
            {merchantBalance != null && merchantValid && (
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                balance: {formatUnits(merchantBalance as bigint, decimals)} {symbol}
              </span>
            )}
          </div>

          <div className="field">
            <label>Token (ERC-20)</label>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x…" />
          </div>

          <div className="field">
            <label>PaymentRouter</label>
            <input value={router} onChange={(e) => setRouter(e.target.value)} placeholder="0x…" />
          </div>

          <div className="field">
            <label>Amount ({symbol}, {decimals} decimals)</label>
            <input value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="50" />
            {insufficientBalance && (
              <span style={{ fontSize: 12, color: "var(--danger)", marginTop: 2 }}>
                insufficient balance — you have {formatUnits(payerBalance as bigint, decimals)} {symbol}
              </span>
            )}
          </div>

          {!isConnected ? (
            <p className="card-sub" style={{ marginTop: 4 }}>
              Connect a wallet to continue.
            </p>
          ) : needsApproval ? (
            <button
              className="btn full"
              onClick={handleApprove}
              disabled={isApproving || isApprovingTx || !tokenValid || !routerValid || wrongNetwork}
            >
              {isApproving
                ? "Confirm approval in wallet…"
                : isApprovingTx
                  ? "Approving on-chain…"
                  : `Approve router to spend ${symbol}`}
            </button>
          ) : (
            <button
              className="btn full"
              onClick={handlePay}
              disabled={
                !isConnected ||
                wrongNetwork ||
                parsedAmount == null ||
                insufficientBalance ||
                phase.stage === "signing" ||
                phase.stage === "queued" ||
                phase.stage === "submitting" ||
                phase.stage === "submitted" ||
                isSigning
              }
            >
              {wrongNetwork
                ? "Switch network to continue"
                : phase.stage === "signing" || isSigning
                  ? "Sign in wallet…"
                  : phase.stage === "queued"
                    ? "Queued — awaiting relayer…"
                    : phase.stage === "submitting"
                      ? "Relayer broadcasting…"
                      : phase.stage === "submitted"
                        ? "Broadcast — awaiting indexer…"
                        : `Sign & pay ${amountStr || "0"} ${symbol}`}
            </button>
          )}

          {(phase.stage !== "idle" || error) && <div className="divider" />}

          {(phase.stage !== "idle" || error) && (
            <>
              <h3>Off-chain pipeline</h3>
              <div className="steps">
                {offChainSteps.map((s, i) => (
                  <div
                    key={s.key}
                    className={`step${s.status === "active" ? " active" : s.status === "done" ? " done" : s.status === "failed" ? " failed" : ""}`}
                  >
                    <span className="num">{i + 1}</span>
                    <span className="label">{s.label}</span>
                    <span className="meta">{s.meta ?? ""}</span>
                  </div>
                ))}
              </div>

              <h3 style={{ marginTop: 18 }}>On-chain pipeline</h3>
              <div className="steps">
                {onChainSteps.map((s, i) => (
                  <div
                    key={s.key}
                    className={`step${s.status === "active" ? " active" : s.status === "done" ? " done" : ""}`}
                  >
                    <span className="num">{offChainSteps.length + i + 1}</span>
                    <span className="label">{s.label}</span>
                    <span className="meta">
                      {s.key === "broadcast" && (phase.stage === "submitted" || phase.stage === "settled") && phase.txHash ? (
                        explorer ? (
                          <a className="ext-link" href={`${explorer}/tx/${phase.txHash}`} target="_blank" rel="noreferrer">
                            {short(phase.txHash)}
                          </a>
                        ) : (
                          short(phase.txHash)
                        )
                      ) : (
                        s.meta ?? ""
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {phase.stage === "failed" && (
                <pre className="result error" style={{ marginTop: 12 }}>
                  {phase.reason}
                </pre>
              )}
              {error && (
                <pre className="result error" style={{ marginTop: 12 }}>
                  {error}
                </pre>
              )}
              {(phase.stage === "settled" || phase.stage === "failed") && (
                <button className="btn ghost" style={{ marginTop: 12 }} onClick={resetFlow}>
                  New payment
                </button>
              )}
            </>
          )}
        </div>

        {/* ── right column ─────────────────────────────────────────── */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* My payments (per-wallet history from orchestrator's intent DB) */}
          {address && (
            <div className="card">
              <div className="card-header" style={{ marginBottom: 0 }}>
                <h2>My payments</h2>
                <span className="chip">{history.length} stored</span>
              </div>
              <p className="card-sub" style={{ marginBottom: 14 }}>
                Persisted payment intents for <Addr value={address} explorer={explorer} />.
              </p>
              {history.length === 0 ? (
                <div className="empty">No payments yet. Submit one above.</div>
              ) : (
                <div className="feed">
                  {history.map((p) => (
                    <div className="feed-row" key={p.id}>
                      <div className="primary">
                        <span>
                          →{" "}<Addr value={p.merchant} explorer={explorer} />
                          {p.txHash && (
                            <>
                              {" "}·{" "}
                              {explorer ? (
                                <a className="ext-link" href={`${explorer}/tx/${p.txHash}`} target="_blank" rel="noreferrer">
                                  {short(p.txHash)}
                                </a>
                              ) : (
                                <span className="mono">{short(p.txHash)}</span>
                              )}
                            </>
                          )}
                        </span>
                        <span className="mono">id {short(p.id)} · nonce {p.nonce}</span>
                      </div>
                      <div className="right">
                        <span className="amount-pill">
                          {formatUnits(BigInt(p.amount), decimals)} {symbol}
                        </span>
                        <span className={statusChipClass(p.status)} style={{ fontSize: 11 }}>
                          {p.status}
                        </span>
                        <span>{relTime(p.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent on-chain settlements (global, from indexer) */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 0 }}>
              <h2>On-chain activity</h2>
              <span className="chip">{events.length} indexed</span>
            </div>
            <p className="card-sub" style={{ marginBottom: 14 }}>
              Live <span className="mono">Settled</span> events from the indexer (Postgres-shaped SQLite locally).
            </p>
            {events.length === 0 ? (
              <div className="empty">No Settled events yet.</div>
            ) : (
              <div className="feed">
                {events.map((e) => (
                  <div className="feed-row" key={`${e.txHash}-${e.logIndex}`}>
                    <div className="primary">
                      <span>
                        <Addr value={e.payer} explorer={explorer} /> →{" "}
                        <Addr value={e.merchant} explorer={explorer} />
                      </span>
                      <span className="mono">
                        {explorer ? (
                          <a className="ext-link" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                            {short(e.txHash)}
                          </a>
                        ) : (
                          short(e.txHash)
                        )}
                        {" · block "}#{e.blockNumber}
                        {e.confirmations != null && ` · ${e.confirmations} conf`}
                      </span>
                    </div>
                    <div className="right">
                      <span className="amount-pill">
                        {formatUnits(BigInt(e.amount), decimals)} {symbol}
                      </span>
                      <span>{relTime(e.indexedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>System</h3>
            <div className="kv">
              <span className="k">Chain</span>
              <span className="v">
                {knownChain ? `${knownChain.name} · ${chainId}` : `unknown · ${chainId || "—"}`}
              </span>
            </div>
            <div className="kv">
              <span className="k">Block</span>
              <span className="v">
                {blockNumber != null ? `#${blockNumber.toString()}` : "—"}
              </span>
            </div>
            <div className="kv">
              <span className="k">Router</span>
              <span className="v">
                <Addr value={router} explorer={explorer} />
              </span>
            </div>
            <div className="kv">
              <span className="k">Token</span>
              <span className="v">
                <Addr value={token} explorer={explorer} />
              </span>
            </div>
            <div className="kv">
              <span className="k">Orchestrator</span>
              <span className="v" style={{ fontFamily: "inherit" }}>
                <span
                  className={`status-pill ${orchestratorOnline ? "online" : "offline"}`}
                  style={{ padding: "2px 8px", fontSize: 11 }}
                >
                  <span className="dot" /> {orchestratorOnline ? "up" : "down"}
                </span>
              </span>
            </div>
            <div className="kv">
              <span className="k">Indexer</span>
              <span className="v" style={{ fontFamily: "inherit" }}>
                <span
                  className={`status-pill ${indexerOnline ? "online" : "offline"}`}
                  style={{ padding: "2px 8px", fontSize: 11 }}
                >
                  <span className="dot" /> {indexerOnline ? "up" : "down"}
                </span>
              </span>
            </div>
          </div>

          <div className="card" id="stack">
            <h3>Stack</h3>
            <div className="stack">
              <span className="chip">Solidity 0.8.26</span>
              <span className="chip">OpenZeppelin v5</span>
              <span className="chip">Foundry</span>
              <span className="chip">Fastify 5</span>
              <span className="chip">BullMQ 5</span>
              <span className="chip">SQLite (better-sqlite3)</span>
              <span className="chip">viem 2</span>
              <span className="chip">Next.js 15</span>
              <span className="chip">wagmi 2</span>
              <span className="chip">RainbowKit 2</span>
            </div>
            <p className="card-sub" style={{ marginTop: 14 }}>
              10/10 forge tests · 100% PaymentRouter coverage · idempotent
              POST /pay · serialized relayer nonce manager · indexed events
              with confirmation tracking · CI on every PR.
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}
