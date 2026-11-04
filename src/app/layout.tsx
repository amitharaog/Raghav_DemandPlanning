import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "./components/Logo";
import { NavLinks } from "./components/NavLinks";
import { SearchBox } from "./components/SearchBox";
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
          <div className="topbar-inner">
            <Link href="/" className="brand" aria-label="Freshroots demand planning home">
              <Logo />
            </Link>
            <NavLinks />
            <Suspense>
              <SearchBox />
            </Suspense>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
