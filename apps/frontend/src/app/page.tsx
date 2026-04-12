import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

export default function Home() {
  const { isConnected, address } = useAccount();

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>FlowPay</h1>
      <p>Mesh-style crypto payments orchestration</p>
      
      <div style={{ marginTop: 24 }}>
        <ConnectButton />
      </div>

      {isConnected && (
        <div style={{ marginTop: 24 }}>
          <h2>Wallet Connected</h2>
          <p>Address: {address}</p>
        </div>
      )}
    </main>
  );
}
