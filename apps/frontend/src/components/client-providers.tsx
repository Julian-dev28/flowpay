"use client";

// Loads <Providers> client-only so RainbowKit / wagmi connectors don't try
// to touch `indexedDB` during SSR (idb-keyval throws ReferenceError under Node).
// Keeping the dynamic boundary in a client component lets us pass `ssr: false`
// while the root layout itself stays a Server Component (it needs to export
// `metadata`).
import dynamic from "next/dynamic";

const Providers = dynamic(
  () => import("./providers").then((m) => m.Providers),
  { ssr: false }
);

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
