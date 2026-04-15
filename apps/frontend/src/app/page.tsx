"use client";

import { useAccount, useConnect } from "wagmi";

export default function Home() {
  const { isConnected, address } = useAccount();
  const { connectors, connect, status, error } = useConnect();

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>FlowPay</h1>
      <p>Mesh-style crypto payments orchestration</p>

      {!isConnected && (
        <div style={{ marginTop: 24 }}>
          <h2>Connect Wallet</h2>
          {connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={() => connect({ connector })}
              style={{ marginRight: 8, padding: "8px 16px" }}
            >
              {connector.name}
            </button>
          ))}
          {status === "pending" && <p>Connecting...</p>}
          {error && <p style={{ color: "red" }}>Error: {error.message}</p>}
        </div>
      )}

      {isConnected && (
        <div style={{ marginTop: 24 }}>
          <h2>Wallet Connected</h2>
          <p>Address: {address}</p>
        </div>
      )}
    </main>
  );
}
