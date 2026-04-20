import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowPay — EIP-712 signed crypto payments on Base",
  description:
    "Gasless signed payment intents. Payers sign, relayers settle, merchants get paid — without holding funds in the router.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
