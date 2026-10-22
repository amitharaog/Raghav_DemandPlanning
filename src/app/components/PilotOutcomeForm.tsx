"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PilotOutcomeForm() {
  const router = useRouter();
  const [period, setPeriod] = useState("");
  const [stockout, setStockout] = useState("");
  const [writeoff, setWriteoff] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/pilot-outcomes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ periodLabel: period, stockoutLossLakh: Number(stockout), writeoffLossLakh: Number(writeoff) }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error ?? res.statusText);
    setPeriod("");
    setStockout("");
    setWriteoff("");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="row">
      <input placeholder="Period, e.g. Q3 FY27" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" />
      <input type="number" step="0.1" min="0" placeholder="Stockouts ₹L" value={stockout} onChange={(e) => setStockout(e.target.value)} style={{ width: 120 }} aria-label="Stockout loss in lakh" />
      <input type="number" step="0.1" min="0" placeholder="Write-offs ₹L" value={writeoff} onChange={(e) => setWriteoff(e.target.value)} style={{ width: 120 }} aria-label="Write-off loss in lakh" />
      <button type="submit">Record actuals</button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}
