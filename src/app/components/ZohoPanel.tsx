"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ZohoStatus = {
  configured: boolean;
  connected: boolean;
  organizationName: string | null;
};

export type PoResult = {
  poNumber: string;
  vendorName: string;
  status: "created" | "failed" | "skipped";
  zohoPoNumber?: string | null;
  error?: string | null;
};

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

const RESULT_LABEL = { created: "Draft created", skipped: "Already in Zoho", failed: "Not sent" } as const;
const RESULT_CLASS = { created: "s-ok", skipped: "s-no-data", failed: "s-kill" } as const;

/** Send / download buttons for one run's approved orders. */
export function ZohoSendButtons({ runId, lines, zoho, lastResults = [] }: { runId: number; lines: number; zoho: ZohoStatus; lastResults?: PoResult[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "zoho" | "csv">(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PoResult[]>(lastResults);

  async function send() {
    setBusy("zoho");
    setError(null);
    try {
      const r = await post(`/api/runs/${runId}/zoho`, { channel: "zoho" });
      setResults(r.results);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function csv() {
    setBusy("csv");
    setError(null);
    try {
      const r = await post(`/api/runs/${runId}/zoho`, { channel: "csv" });
      window.location.href = `/api/zoho-exports/${r.exportId}`;
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-sm">
      <div className="row" style={{ gap: 8 }}>
        {zoho.connected ? (
          <>
            <button className="primary" onClick={send} disabled={!lines || busy !== null}>
              {busy === "zoho" ? "Sending…" : "Send to Zoho as drafts"}
            </button>
            <button onClick={csv} disabled={!lines || busy !== null}>
              {busy === "csv" ? "Preparing…" : "Download CSV"}
            </button>
          </>
        ) : (
          <button className="primary" onClick={csv} disabled={!lines || busy !== null}>
            {busy === "csv" ? "Preparing…" : "Download Zoho CSV"}
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      {results.length > 0 && (
        <ul className="po-results">
          {results.map((r) => (
            <li key={r.poNumber}>
              <span className={`pill ${RESULT_CLASS[r.status]}`}>
                <span className="dot" />
                {RESULT_LABEL[r.status]}
              </span>
              <span>
                <b>{r.vendorName}</b> {r.zohoPoNumber ? <span className="muted">· {r.zohoPoNumber}</span> : null}
                {r.status === "failed" && r.error && <span className="error small"> · {r.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Connection status, connect / disconnect and open-PO sync. */
export function ZohoConnection({ zoho }: { zoho: ZohoStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [dc, setDc] = useState("in");

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ text: await fn(), error: false });
      router.refresh();
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  if (!zoho.configured) {
    return <p className="faint small">Zoho is not set up: add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in Vercel.</p>;
  }

  if (zoho.connected) {
    return (
      <div className="stack-sm">
        <div className="row small" style={{ gap: 10 }}>
          <span className="pill s-ok">
            <span className="dot" /> Zoho connected
          </span>
          <span className="muted">{zoho.organizationName}</span>
          <button
            className="small"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await post("/api/zoho/sync-open-pos");
                return `Synced ${r.poLines} open PO line(s): ${r.units.toLocaleString("en-IN")} units on order across ${r.skus} SKU(s). The next run uses them.${
                  r.ignoredSkus.length ? ` Ignored SKUs not in SAP: ${r.ignoredSkus.join(", ")}.` : ""
                }`;
              })
            }
          >
            {busy ? "Syncing…" : "Sync open POs"}
          </button>
          <button className="small link" disabled={busy} onClick={() => run(async () => (await post("/api/zoho/disconnect"), "Zoho disconnected."))}>
            Disconnect
          </button>
        </div>
        {msg && <p className={`small ${msg.error ? "error" : "muted"}`}>{msg.text}</p>}
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <div className="row small" style={{ gap: 10 }}>
        <span className="pill s-no-data">
          <span className="dot" /> Zoho not connected
        </span>
        <label className="small muted">
          Zoho region{" "}
          <select value={dc} onChange={(e) => setDc(e.target.value)} aria-label="Zoho data centre">
            <option value="in">India (zoho.in)</option>
            <option value="com">US (zoho.com)</option>
            <option value="eu">EU (zoho.eu)</option>
            <option value="com.au">Australia (zoho.com.au)</option>
          </select>
        </label>
        <a className="btn small" href={`/api/zoho/connect?dc=${dc}`}>
          Connect Zoho
        </a>
      </div>
      <details>
        <summary className="small">Using a Self Client? Paste a code instead</summary>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1000.xxxx…" aria-label="Self Client code" style={{ minWidth: 0, flex: 1 }} />
          <button
            className="small"
            disabled={busy || !code.trim()}
            onClick={() =>
              run(async () => {
                const r = await post("/api/zoho/connect-code", { code, accountsServer: `https://accounts.zoho.${dc}` });
                setCode("");
                return `Connected to ${r.organizationName}.`;
              })
            }
          >
            Connect
          </button>
        </div>
      </details>
      {msg && <p className={`small ${msg.error ? "error" : "muted"}`}>{msg.text}</p>}
    </div>
  );
}
