import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freshroots Demand Planning",
  description: "Twice-weekly demand planning: SAP data, Raghav's rules, his call, Zoho purchase orders.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Fresh<span>roots</span> Demand Planning
          </Link>
          <nav>
            <Link href="/">Dashboard</Link>
            <Link href="/review">Raghav&apos;s review</Link>
            <Link href="/trends">Trends</Link>
            <Link href="/history">Run history</Link>
          </nav>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
