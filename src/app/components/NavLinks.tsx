"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", icon: "▦", match: (p: string) => p === "/" },
  { href: "/review", label: "Review", icon: "✓", match: (p: string) => p === "/review" || /^\/runs\/\d+$/.test(p) },
  { href: "/trends", label: "Trends", icon: "↗", match: (p: string) => p === "/trends" || p.endsWith("/trends") },
  { href: "/learning", label: "Learning", icon: "↻", match: (p: string) => p === "/learning" },
  { href: "/history", label: "History", icon: "☰", match: (p: string) => p === "/history" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={l.match(path) ? "active" : undefined} aria-current={l.match(path) ? "page" : undefined}>
          <span className="nav-ico" aria-hidden>{l.icon}</span>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
