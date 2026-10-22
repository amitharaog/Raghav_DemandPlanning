"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", match: (p: string) => p === "/" },
  { href: "/review", label: "Review", match: (p: string) => p === "/review" || /^\/runs\/\d+$/.test(p) },
  { href: "/trends", label: "Trends", match: (p: string) => p === "/trends" || p.endsWith("/trends") },
  { href: "/history", label: "History", match: (p: string) => p === "/history" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={l.match(path) ? "active" : undefined} aria-current={l.match(path) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
