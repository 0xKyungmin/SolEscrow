import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolEscrow",
  description: "Trustless milestone-based escrow payments on Solana",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
