"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunNowButton({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runDate: date }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setMsg({ text: `Run #${body.runId}: ${body.status}. ${body.message}`, error: body.status !== "completed" });
      router.refresh();
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <label className="small muted">
          Run date{" "}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Run date" />
        </label>
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run now"}
        </button>
      </div>
      {msg && <div className={`small ${msg.error ? "error" : "muted"}`} style={{ maxWidth: 520, marginTop: 4 }}>{msg.text}</div>}
    </div>
  );
}
