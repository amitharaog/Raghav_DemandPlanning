import Link from "next/link";
import { getPool } from "@/lib/db";
import { int, istDateTime, nextScheduledRun } from "@/lib/format";
import { killCall, PILOT } from "@/lib/killCriteria";
import {
  getLatestCompletedRunId,
  getRecommendations,
  getRun,
  listPilotOutcomes,
  listRunStats,
  listZohoExports,
  statsFor,
} from "@/lib/queries";
import { todayIST } from "@/lib/weeks";
import { StatusBadge } from "./components/Badges";
import { PilotOutcomeForm } from "./components/PilotOutcomeForm";
import { RunNowButton } from "./components/RunNowButton";
import { ZohoExportButton } from "./components/ZohoExportButton";

export const dynamic = "force-dynamic";

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function dataStatus() {
  const db = getPool();
  const stockAsOf = (await db.query(`select max(as_of_date) as d from inventory_snapshots`)).rows[0]?.d as string | null;
  const skus = (await db.query(`select count(*)::int as n from skus`)).rows[0].n as number;
  return { stockAsOf, skus };
}

export default async function Overview() {
  const [data, runs, outcomes, latestCompletedId] = await Promise.all([
    dataStatus(),
    listRunStats(50),
    listPilotOutcomes(),
    getLatestCompletedRunId(),
  ]);
  const latest = runs[0] ?? null;
  const run = latestCompletedId ? await getRun(latestCompletedId) : null;
  const recs = run ? await getRecommendations(run.id) : [];
  const exports = run ? await listZohoExports(run.id) : [];
  const stats = run ? statsFor(run, recs, exports.length) : null;
  const call = killCall(runs, outcomes, todayIST());
  const defaultDate = process.env.RUN_DATE_OVERRIDE?.trim() || todayIST();

  const head = (
    <div className="page-head">
      <div>
        <p className="eyebrow">Overview</p>
        <h1>{run ? `Plan for ${longDate(run.runDate)}` : "No plan yet"}</h1>
        <div className="meta">
          {run && <span className="chip-soft">Run #{run.id}</span>}
          {recs[0]?.numbers.isFestivalMonth && <span className="chip-soft">Festival month · demand ×1.25</span>}
          <span className="faint small">Next automatic run {istDateTime(nextScheduledRun().toISOString())} IST</span>
        </div>
      </div>
      <RunNowButton defaultDate={defaultDate} />
    </div>
  );

  if (!run || !stats) {
    return (
      <div className="stack">
        {head}
        <div className="card empty">Load the SAP export, then press Run now to create the first plan.</div>
      </div>
    );
  }

  const count = (f: string) => recs.filter((r) => r.flag === f).length;
  const toOrder = recs.filter((r) => r.action === "REORDER");
  const unitsToOrder = toOrder.reduce((n, r) => n + (r.suggestedQty ?? 0), 0);
  const pending = recs.length - stats.decided;
  const pct = (n: number) => `${(n / recs.length) * 100}%`;
  const poUnits = recs
    .filter((r) => r.decision && r.decision.decision !== "HOLD" && (r.decision.finalQty ?? 0) > 0)
    .reduce((n, r) => n + (r.decision!.finalQty ?? 0), 0);
  const vendors = new Set(
    recs.filter((r) => r.decision && r.decision.decision !== "HOLD" && (r.decision.finalQty ?? 0) > 0).map((r) => r.distributorName),
  ).size;
  const halted = latest && latest.status !== "completed" ? latest : null;
  const pilotIssues = call.checks.filter((c) => c.status === "watch" || c.status === "kill");

  return (
    <div className="stack">
      {head}

      {halted && (
        <div className="banner KILL">
          <span className="ico">!</span>
          <div>
            <b>Run #{halted.id} for {longDate(halted.runDate)} was stopped by the data checks.</b>{" "}
            <span className="muted">
              {(halted.haltReasons[0] ?? halted.error ?? "Unknown error").split(":")[0].replace(/\.$/, "")}. Showing the plan from run #{run.id}.{" "}
              <Link href="/history">Details</Link>
            </span>
          </div>
        </div>
      )}

      <section aria-labelledby="actions-title">
        <div className="section-title">
          <h2 id="actions-title">What this run recommends</h2>
          <Link href={`/runs/${run.id}`} className="small">
            See all {recs.length} SKUs
          </Link>
        </div>
        <div className="actions">
          <Link className="action tone-order" href={`/runs/${run.id}?flag=ORDER`}>
            <span className="label">Order now</span>
            <span className="value">{toOrder.length}</span>
            <span className="hint">
              {count("STOCKOUT")} stockout risk · {count("HIGH_DEMAND")} high demand · {int(unitsToOrder)} units
            </span>
          </Link>
          <Link className="action tone-pause" href={`/runs/${run.id}?flag=OVERSTOCK`}>
            <span className="label">Pause next order</span>
            <span className="value">{count("OVERSTOCK")}</span>
            <span className="hint">Too much stock on hand</span>
          </Link>
          <Link className="action tone-call" href={`/runs/${run.id}?flag=JUDGMENT`}>
            <span className="label">Needs Raghav&apos;s call</span>
            <span className="value">{count("JUDGMENT")}</span>
            <span className="hint">New launch, missing data or mixed signals</span>
          </Link>
          <Link className="action tone-ok" href={`/runs/${run.id}?flag=OK`}>
            <span className="label">On track</span>
            <span className="value">{count("OK")}</span>
            <span className="hint">No action needed</span>
          </Link>
        </div>
      </section>

      <section className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Raghav&apos;s review</h2>
              <p className="muted small">Approve, change or hold each recommendation.</p>
            </div>
            <Link className="btn primary" href={`/runs/${run.id}${pending ? "?pending=1" : ""}`}>
              {pending ? "Continue review" : "Open review"}
            </Link>
          </div>
          <div className="stack-sm">
            <div className="row spread">
              <span className="big-number">
                {stats.decided}
                <span className="faint" style={{ fontSize: 16, fontWeight: 500 }}> / {recs.length} decided</span>
              </span>
              {pending > 0 && <span className="chip-soft">{pending} waiting</span>}
            </div>
            <div className="progress" aria-hidden>
              <span style={{ width: pct(stats.approved), background: "var(--good)" }} />
              <span style={{ width: pct(stats.changed), background: "var(--info)" }} />
              <span style={{ width: pct(stats.held), background: "var(--warning)" }} />
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--good)" }} />Approved {stats.approved}</span>
              <span><i style={{ background: "var(--info)" }} />Qty changed {stats.changed}</span>
              <span><i style={{ background: "var(--warning)" }} />Held {stats.held}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Purchase orders for Zoho</h2>
              <p className="muted small">Only approved items with a quantity go out.</p>
            </div>
            <ZohoExportButton runId={run.id} disabled={!stats.poLines} />
          </div>
          {stats.poLines ? (
            <div className="row" style={{ gap: 28 }}>
              <div>
                <div className="big-number">{stats.poLines}</div>
                <div className="faint small">order lines</div>
              </div>
              <div>
                <div className="big-number">{int(poUnits)}</div>
                <div className="faint small">units</div>
              </div>
              <div>
                <div className="big-number">{vendors}</div>
                <div className="faint small">{vendors === 1 ? "vendor" : "vendors"}</div>
              </div>
            </div>
          ) : (
            <p className="muted">Nothing approved yet. Approved orders will appear here.</p>
          )}
          {exports[0] && (
            <p className="small faint" style={{ marginTop: 12 }}>
              Last CSV {istDateTime(exports[0].createdAt)} ·{" "}
              <a href={`/api/zoho-exports/${exports[0].id}`}>Download again</a>
            </p>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="flow-title">
        <div className="card-head">
          <h2 id="flow-title">How this plan was made</h2>
          <span className="faint small">Started {istDateTime(run.startedAt)} IST</span>
        </div>
        <ol className="steps">
          <li>
            <span className="node">✓</span>
            <span className="name">SAP data</span>
            <span className="desc">
              {data.skus} SKUs · stock as of {data.stockAsOf ? longDate(data.stockAsOf) : "–"}
            </span>
          </li>
          <li>
            <span className="node">✓</span>
            <span className="name">Excel extract</span>
            <span className="desc">{run.hasExtract ? <a href={`/api/runs/${run.id}/extract`}>Download .xlsx</a> : "–"}</span>
          </li>
          <li>
            <span className="node">✓</span>
            <span className="name">Trends</span>
            <span className="desc"><Link href={`/runs/${run.id}/trends`}>4 vs 12 weeks</Link></span>
          </li>
          <li>
            <span className="node">✓</span>
            <span className="name">Forecast</span>
            <span className="desc">Raghav&apos;s rules on {recs.length} SKUs</span>
          </li>
          <li>
            <span className={`node ${pending ? "manual" : ""}`}>{pending ? "5" : "✓"}</span>
            <span className="name">Raghav&apos;s call</span>
            <span className="desc">{pending ? `${pending} waiting` : "All decided"}</span>
          </li>
          <li>
            <span className={`node ${exports.length ? "" : "todo"}`}>{exports.length ? "✓" : "6"}</span>
            <span className="name">Zoho POs</span>
            <span className="desc">{exports.length ? "CSV generated" : "Not sent yet"}</span>
          </li>
        </ol>
      </section>

      <details className="card">
        <summary>
          <span className="row" style={{ gap: 10 }}>
            <h2>Pilot health</h2>
            <span className={`pill s-${call.verdict === "KILL" ? "kill" : call.verdict === "WATCH" ? "watch" : "ok"}`}>
              <span className="dot" /> {call.verdict === "CONTINUE" ? "On track" : call.verdict === "WATCH" ? "Watch" : "Stop and fix"}
            </span>
            {call.pilotDay && <span className="faint small">Day {call.pilotDay} of {PILOT.lengthDays}</span>}
            {pilotIssues.length > 0 && <span className="muted small">{pilotIssues.map((c) => `${c.name}: ${c.value}`).join(" · ")}</span>}
          </span>
        </summary>
        <div className="stack">
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Now</th>
                <th>Limit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {call.checks.map((c) => (
                <tr key={c.name}>
                  <td>
                    {c.name}
                    <div className="faint small">{c.gate} gate</div>
                  </td>
                  <td>{c.value}</td>
                  <td className="small muted">{c.limit}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="stack-sm">
            <h3>Record quarterly losses</h3>
            <p className="muted small">
              Baseline from the case study: ₹{PILOT.baselineLossLakh.low}–{PILOT.baselineLossLakh.high} lakh a quarter in stockouts
              and write-offs. The pilot stops if that falls less than {PILOT.minLossReduction * 100}% by day {PILOT.lengthDays}.
            </p>
            <PilotOutcomeForm />
          </div>
        </div>
      </details>

      {run.warnings.length > 0 && (
        <details className="card">
          <summary>
            <span className="row" style={{ gap: 10 }}>
              <h2>Notes on this data</h2>
              <span className="chip-soft">{run.warnings.length}</span>
            </span>
          </summary>
          <ul className="warn-list muted">
            {run.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
