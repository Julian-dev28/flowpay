"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { useState } from "react";
import { WagmiProvider, http } from "wagmi";
import { base, baseSepolia, foundry } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  getDefaultConfig,
  darkTheme,
} from "@rainbow-me/rainbowkit";

// WalletConnect projectId — required by RainbowKit's default config to enable
// the WalletConnect transport. If NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID isn't
// set we fall back to a known demo project id so local development still
// renders the modal. Replace with your own for any deployed environment.
const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID ??
  "21fef48091f12692cad574a6f7753643"; // RainbowKit's public demo project id

const wagmiConfig = getDefaultConfig({
  appName: "FlowPay",
  projectId: WC_PROJECT_ID,
  chains: [base, baseSepolia, foundry],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [foundry.id]: http("http://localhost:8545"),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#7c5cff",
            accentColorForeground: "white",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
          initialChain={baseSepolia}
          modalSize="wide"
          appInfo={{
            appName: "FlowPay",
            learnMoreUrl: "https://github.com/julian-martinez/flowpay",
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
