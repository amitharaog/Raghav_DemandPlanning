"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ZohoExportButton({ runId, disabled, compact }: { runId: number; disabled?: boolean; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/zoho`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      window.location.href = `/api/zoho-exports/${body.exportId}`;
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button className={compact ? "small" : "primary"} onClick={exportCsv} disabled={busy || disabled}>
        {busy ? "Exporting…" : "Generate Zoho PO CSV"}
      </button>
      {error && <span className="error small"> {error}</span>}
    </span>
  );
}
