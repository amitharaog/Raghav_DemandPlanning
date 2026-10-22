"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { int, num, pctChange } from "@/lib/format";
import type { RecRow } from "@/lib/queries";
import { FLAG_LABEL, FLAGS, type Action, type Flag } from "@/lib/rules";
import { FlagBadge } from "./Badges";

type SortKey = "sku" | "flag" | "wos" | "change" | "qty" | "decision";
type Editing = { recId: number; kind: "CHANGE_QTY" | "HOLD"; qty: string; reason: string } | null;

const FLAG_ORDER: Record<Flag, number> = { JUDGMENT: 0, STOCKOUT: 1, HIGH_DEMAND: 2, OVERSTOCK: 3, OK: 4 };
const DECISION_LABEL = { APPROVE: "Approved", CHANGE_QTY: "Qty changed", HOLD: "Held" } as const;

function recommendation(action: Action, qty: number | null, unit: string): string {
  switch (action) {
    case "REORDER": return `Order ${qty?.toLocaleString("en-IN")} ${unit.toLowerCase()}`;
    case "PAUSE": return "Pause next order";
    case "NO_ACTION": return "No action";
    case "REVIEW": return "Your call";
  }
}

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

export type FlagFilter = Flag | "ORDER";

export function ReviewTable({
  runId,
  recs,
  editable,
  initialFlag,
  initialPending = false,
}: {
  runId: number;
  recs: RecRow[];
  editable: boolean;
  initialFlag: FlagFilter | null;
  initialPending?: boolean;
}) {
  const router = useRouter();
  const [flag, setFlag] = useState<FlagFilter | null>(initialFlag);
  const [pendingOnly, setPendingOnly] = useState(initialPending);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "flag", dir: 1 });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const bulkCandidates = recs.filter((r) => r.flag !== "JUDGMENT" && !r.decision).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = recs.filter(
      (r) =>
        (!flag || (flag === "ORDER" ? r.action === "REORDER" : r.flag === flag)) &&
        (!pendingOnly || !r.decision) &&
        (!q || r.skuId.toLowerCase().includes(q) || r.skuName.toLowerCase().includes(q)),
    );
    const val = (r: RecRow): number | string => {
      switch (sort.key) {
        case "sku": return r.skuId;
        case "flag": return FLAG_ORDER[r.flag] * 1000 + (r.numbers.weeksOfStock ?? 999);
        case "wos": return r.numbers.weeksOfStock ?? Number.POSITIVE_INFINITY;
        case "change": return r.numbers.ratio4to12 ?? 0;
        case "qty": return r.suggestedQty ?? -1;
        case "decision": return r.decision ? r.decision.decision : "~";
      }
    };
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [recs, flag, pendingOnly, query, sort]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const decide = (recId: number, body: object) => act(() => post(`/api/recommendations/${recId}/decision`, body));

  function header(key: SortKey, label: string, numeric = false) {
    const on = sort.key === key;
    return (
      <th
        className={`sortable${numeric ? " n" : ""}`}
        onClick={() => setSort({ key, dir: on ? ((-sort.dir) as 1 | -1) : 1 })}
        aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      >
        {label} {on ? (sort.dir === 1 ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="stack">
      <div className="row spread">
        <div className="chips" role="group" aria-label="Filter by flag">
          <button className={`chip${flag === null ? " on" : ""}`} onClick={() => setFlag(null)}>
            All ({recs.length})
          </button>
          <button className={`chip${flag === "ORDER" ? " on" : ""}`} onClick={() => setFlag(flag === "ORDER" ? null : "ORDER")}>
            Order now ({recs.filter((r) => r.action === "REORDER").length})
          </button>
          {FLAGS.map((f) => (
            <button key={f} className={`chip${flag === f ? " on" : ""}`} onClick={() => setFlag(flag === f ? null : f)}>
              {FLAG_LABEL[f]} ({recs.filter((r) => r.flag === f).length})
            </button>
          ))}
        </div>
        <div className="row">
          <label className="small">
            <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> Pending only
          </label>
          <input placeholder="Search SKU" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search SKU" />
          {editable && (
            <button
              className="primary"
              disabled={busy || bulkCandidates === 0}
              onClick={() =>
                act(async () => {
                  const r = await post(`/api/runs/${runId}/bulk-approve`);
                  setNotice(`Approved ${r.approved} rule-based item(s). Judgment items still need your call.`);
                })
              }
            >
              Bulk approve all rule-based items ({bulkCandidates})
            </button>
          )}
        </div>
      </div>
      {error && <div className="banner KILL">{error}</div>}
      {notice && <div className="banner CONTINUE">{notice}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {header("sku", "SKU")}
              {header("flag", "Flag")}
              {header("qty", "Recommendation")}
              {header("wos", "Weeks of stock", true)}
              <th>Why</th>
              {header("decision", "Raghav's call")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const n = r.numbers;
              const isOpen = open.has(r.id);
              const ed = editing?.recId === r.id ? editing : null;
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      <b>{r.skuId}</b>
                      <div className="muted small">{r.skuName}</div>
                      <button
                        className="small link"
                        onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(r.id)) x.delete(r.id); else x.add(r.id); return x; })}
                      >
                        {isOpen ? "Hide numbers" : "Show numbers"}
                      </button>
                    </td>
                    <td>
                      <FlagBadge flag={r.flag} />
                      {r.alsoFlagged.length > 0 && (
                        <div className="muted small">also: {r.alsoFlagged.map((f) => FLAG_LABEL[f]).join(", ")}</div>
                      )}
                      {r.perishability === "High" && <div className="tag" style={{ display: "inline-block", marginTop: 4 }}>perishable</div>}
                    </td>
                    <td className="nowrap">
                      <b>{recommendation(r.action as Action, r.suggestedQty, r.unitOfMeasure)}</b>
                    </td>
                    <td className="n">
                      <b>{num(n.weeksOfStock, 1)}</b>
                      <div className="faint small">healthy {n.stockoutBelow}–{n.overstockAbove}</div>
                    </td>
                    <td className="reason small">
                      {r.reason}
                      {r.reasonSource === "llm" && (
                        <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                          <span className="tag">Claude</span>
                          <button
                            className="small link"
                            title="Tell us the reason text is wrong (feeds the AI kill criterion)"
                            onClick={() => act(() => post(`/api/recommendations/${r.id}/reason-feedback`, { wrong: !r.reasonMarkedWrong }))}
                          >
                            {r.reasonMarkedWrong ? "Marked wrong ✕" : "Reason wrong?"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="decision">
                      {r.decision && !ed && (
                        <div>
                          <b>{DECISION_LABEL[r.decision.decision]}</b>
                          {r.decision.finalQty !== null && <> · {r.decision.finalQty}</>}
                          {r.decision.bulk && <span className="tag"> bulk</span>}
                          {r.decision.reason && <div className="small">“{r.decision.reason}”</div>}
                          <div className="muted small">
                            {r.decision.decidedBy}, {new Date(r.decision.decidedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                            {r.decisionCount > 1 && ` · ${r.decisionCount} decisions logged`}
                          </div>
                        </div>
                      )}
                      {editable && !ed && (
                        <div className="row" style={{ gap: 4, marginTop: 4 }}>
                          {r.flag !== "JUDGMENT" && (
                            <button className="small" disabled={busy} onClick={() => decide(r.id, { decision: "APPROVE" })}>
                              Approve
                            </button>
                          )}
                          <button className="small" disabled={busy} onClick={() => setEditing({ recId: r.id, kind: "CHANGE_QTY", qty: String(r.decision?.finalQty ?? r.suggestedQty ?? ""), reason: "" })}>
                            {r.flag === "JUDGMENT" ? "Set qty" : "Change qty"}
                          </button>
                          <button className="small" disabled={busy} onClick={() => setEditing({ recId: r.id, kind: "HOLD", qty: "", reason: "" })}>
                            Hold
                          </button>
                        </div>
                      )}
                      {ed && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            decide(r.id, ed.kind === "HOLD" ? { decision: "HOLD", reason: ed.reason } : { decision: "CHANGE_QTY", qty: ed.qty === "" ? null : Number(ed.qty), reason: ed.reason });
                          }}
                        >
                          {ed.kind === "CHANGE_QTY" && (
                            <label className="small">
                              Qty <input type="number" min={0} step={1} value={ed.qty} onChange={(e) => setEditing({ ...ed, qty: e.target.value })} autoFocus />
                            </label>
                          )}
                          <textarea
                            rows={2}
                            style={{ width: "100%", marginTop: 4 }}
                            placeholder={ed.kind === "HOLD" ? "Why hold? (required)" : "Why change? (required)"}
                            value={ed.reason}
                            onChange={(e) => setEditing({ ...ed, reason: e.target.value })}
                            autoFocus={ed.kind === "HOLD"}
                          />
                          <div className="row" style={{ gap: 4 }}>
                            <button className="small primary" type="submit" disabled={busy || !ed.reason.trim()}>
                              Save {ed.kind === "HOLD" ? "hold" : "qty"}
                            </button>
                            <button className="small" type="button" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="sub">
                      <td colSpan={6}>
                        <div className="grid cols-2">
                          <div>
                            <b>Rule fired:</b> {r.ruleFired}
                            <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                              {r.ruleTrace.map((t) => (
                                <li key={t}>{t}</li>
                              ))}
                            </ol>
                          </div>
                          <div className="kv">
                            <span className="muted">4-week average / week</span><span>{num(n.avg4)}</span>
                            <span className="muted">12-week average / week</span><span>{num(n.avg12)} ({pctChange(n.ratio4to12)})</span>
                            <span className="muted">Stock on hand</span><span>{int(n.stockOnHand)}</span>
                            <span className="muted">Stock on order</span><span>{int(n.onOrder)}</span>
                            <span className="muted">Festival uplift</span><span>{n.isFestivalMonth ? `×${n.upliftFactor}` : "none"}</span>
                            <span className="muted">Expected demand / week</span><span>{num(n.forecastWeekly)}</span>
                            <span className="muted">Weeks of stock before uplift</span><span>{num(n.weeksOfStockRaw, 2)}</span>
                            <span className="muted">Weeks of cover after this order</span><span>{num(n.coverAfterOrder, 2)}</span>
                            <span className="muted">Standard reorder qty</span><span>{n.standardReorderQty}</span>
                            <span className="muted">Weeks of history</span><span>{n.weeksOfHistory}</span>
                            <span className="muted">Vendor (PO goes to)</span><span>{r.distributorName}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="muted">No recommendations match the filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
