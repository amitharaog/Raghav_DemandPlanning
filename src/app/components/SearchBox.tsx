"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Pinterest-style search pill: finds a SKU in the latest plan. */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/review${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKUs, e.g. mango or SKU011" aria-label="Search SKUs" />
    </form>
  );
}
