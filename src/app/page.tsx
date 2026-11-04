import Link from "next/link";
import { getPool } from "@/lib/db";
import { int, istDateTime, nextScheduledRun } from "@/lib/format";
import { buildFeedback } from "@/lib/feedback";
import { killCall, PILOT } from "@/lib/killCriteria";
import {
  getFeedbackFacts,
  getLatestCompletedRunId,
  getRecommendations,
  getRun,
  listPilotOutcomes,
  listRunStats,
  getZohoStatus,
  lastZohoResults,
  listZohoExports,
  statsFor,
} from "@/lib/queries";
import { todayIST } from "@/lib/weeks";
import { StatusBadge } from "./components/Badges";
import { PilotOutcomeForm } from "./components/PilotOutcomeForm";
import { RunNowButton } from "./components/RunNowButton";
import { ZohoConnection, ZohoSendButtons } from "./components/ZohoPanel";

export const dynamic = "force-dynamic";

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function dataStatus() {
  const db = getPool();
  const stockAsOf = (await db.query(`select max(as_of_date) as d from inventory_snapshots`)).rows[0]?.d as string | null;
  const skus = (await db.query(`select count(*)::int as n from skus`)).rows[0].n as number;
  return { stockAsOf, skus };
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ zoho?: string; zoho_msg?: string }> }) {
  const { zoho: zohoFlag, zoho_msg: zohoMsg } = await searchParams;
  const [data, runs, outcomes, latestCompletedId, zoho, facts] = await Promise.all([
    dataStatus(),
    listRunStats(50),
    listPilotOutcomes(),
    getLatestCompletedRunId(),
    getZohoStatus(),
    getFeedbackFacts(),
  ]);
  const feedback = buildFeedback(facts);
  const latest = runs[0] ?? null;
  const run = latestCompletedId ? await getRun(latestCompletedId) : null;
  const recs = run ? await getRecommendations(run.id) : [];
  const exports = run ? await listZohoExports(run.id) : [];
  const zohoResults = run ? await lastZohoResults(run.id) : [];
  const sentToZoho = zohoResults.filter((r) => r.status !== "failed").length;
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

      {zohoFlag === "connected" && (
        <div className="banner CONTINUE">
          <span className="ico">✓</span>
          <span>Zoho is connected{zoho.organizationName ? ` to ${zoho.organizationName}` : ""}. Approved orders can now go to Zoho as drafts.</span>
        </div>
      )}
      {zohoFlag === "error" && (
        <div className="banner KILL">
          <span className="ico">!</span>
          <span>Zoho could not be connected: {zohoMsg ?? "unknown error"}</span>
        </div>
      )}

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
          <Link href={`/runs/${run.id}`} className="chip-soft">
            See all {recs.length} SKUs →
          </Link>
        </div>
        <div className="actions">
          <Link className="action tone-order" href={`/runs/${run.id}?flag=ORDER`}>
            <span className="glyph" aria-hidden>!</span>
            <span className="label">Order now</span>
            <span className="value">{toOrder.length}</span>
            <span className="hint">
              {count("STOCKOUT")} stockout risk · {count("HIGH_DEMAND")} high demand · {int(unitsToOrder)} units
            </span>
            <span className="go" aria-hidden>→</span>
          </Link>
          <Link className="action tone-pause" href={`/runs/${run.id}?flag=OVERSTOCK`}>
            <span className="glyph" aria-hidden>■</span>
            <span className="label">Pause next order</span>
            <span className="value">{count("OVERSTOCK")}</span>
            <span className="hint">Too much stock on hand</span>
            <span className="go" aria-hidden>→</span>
          </Link>
          <Link className="action tone-call" href={`/runs/${run.id}?flag=JUDGMENT`}>
            <span className="glyph" aria-hidden>?</span>
            <span className="label">Needs Raghav&apos;s call</span>
            <span className="value">{count("JUDGMENT")}</span>
            <span className="hint">New launch, missing data or mixed signals</span>
            <span className="go" aria-hidden>→</span>
          </Link>
          <Link className="action tone-ok" href={`/runs/${run.id}?flag=OK`}>
            <span className="glyph" aria-hidden>✓</span>
            <span className="label">On track</span>
            <span className="value">{count("OK")}</span>
            <span className="hint">No action needed</span>
            <span className="go" aria-hidden>→</span>
          </Link>
        </div>
      </section>

      <section className="board" aria-label="Plan details">
        <div className="card pin">
          <div className="card-head">
            <div>
              <h2>Raghav&apos;s review</h2>
              <p className="muted small">Approve, change or hold each recommendation.</p>
            </div>
          </div>
          <div className="stack-sm">
            <div className="row spread">
              <span className="big-number">
                {stats.decided}
                <span className="faint" style={{ fontSize: 16, fontWeight: 600 }}> / {recs.length} decided</span>
              </span>
              {pending > 0 && <span className="pill s-watch"><span className="dot" />{pending} waiting</span>}
            </div>
            <div className="progress" aria-hidden>
              <span style={{ width: pct(stats.approved), background: "var(--good)" }} />
              <span style={{ width: pct(stats.changed), background: "var(--info)" }} />
              <span style={{ width: pct(stats.held), background: "var(--warning)" }} />
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--good)" }} />Approved {stats.approved}</span>
              <span><i style={{ background: "var(--info)" }} />Changed {stats.changed}</span>
              <span><i style={{ background: "var(--warning)" }} />Held {stats.held}</span>
            </div>
            <Link className="btn primary" style={{ marginTop: 6 }} href={`/runs/${run.id}${pending ? "?pending=1" : ""}`}>
              {pending ? "Continue review" : "Open review"}
            </Link>
          </div>
        </div>

        <div className="card pin">
          <div className="card-head">
            <div>
              <h2>Purchase orders for Zoho</h2>
              <p className="muted small">
                Only approved items with a quantity go out{zoho.connected ? ", as drafts procurement still issues" : ""}.
              </p>
            </div>
          </div>
          {stats.poLines ? (
            <div className="stats" style={{ marginBottom: 16 }}>
              <div className="stat">
                <div className="big-number">{stats.poLines}</div>
                <div className="faint small">order lines</div>
              </div>
              <div className="stat">
                <div className="big-number">{int(poUnits)}</div>
                <div className="faint small">units</div>
              </div>
              <div className="stat">
                <div className="big-number">{vendors}</div>
                <div className="faint small">{vendors === 1 ? "vendor" : "vendors"}</div>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ marginBottom: 16 }}>Nothing approved yet. Approved orders will appear here.</p>
          )}
          <ZohoSendButtons runId={run.id} lines={stats.poLines} zoho={zoho} lastResults={zohoResults} />
          <hr className="divider" />
          <ZohoConnection zoho={zoho} />
        </div>

        <Link className="card pin tone-info" href="/learning" style={{ background: "var(--info-bg)", color: "var(--text)" }}>
          <div className="pin-title">
            <h2>What the last runs taught us</h2>
            <span aria-hidden>→</span>
          </div>
          <div className="stats" style={{ marginBottom: 12 }}>
            <div className="stat" style={{ background: "var(--surface)" }}>
              <div className="big-number">
                {feedback.forecast.error === null ? "–" : `${Math.round(feedback.forecast.error * 100)}%`}
              </div>
              <div className="faint small">forecast miss</div>
            </div>
            <div className="stat" style={{ background: "var(--surface)" }}>
              <div className="big-number">{feedback.suggestions.length}</div>
              <div className="faint small">suggestion{feedback.suggestions.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <p className="small muted">
            {feedback.suggestions[0]
              ? feedback.suggestions[0].title
              : feedback.forecast.measured
                ? "No rule changes suggested yet."
                : `Waiting for sales after the run to check ${feedback.forecast.pending} forecasts.`}
          </p>
        </Link>

        <section className="card pin" aria-labelledby="flow-title">
          <div className="card-head">
            <h2 id="flow-title">How this plan was made</h2>
            <span className="faint small">{istDateTime(run.startedAt)} IST</span>
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
              <span className="desc">
                {sentToZoho ? `${sentToZoho} draft PO${sentToZoho === 1 ? "" : "s"} in Zoho` : exports.length ? "CSV generated" : "Not sent yet"}
              </span>
            </li>
            <li>
              <span className="node manual">↻</span>
              <span className="name">Feedback</span>
              <span className="desc"><Link href="/learning">Sales and Raghav&apos;s calls feed the next run</Link></span>
            </li>
          </ol>
        </section>

        <details className="card pin">
          <summary>
            <span className="row" style={{ gap: 10 }}>
              <h2>Pilot health</h2>
              <span className={`pill s-${call.verdict === "KILL" ? "kill" : call.verdict === "WATCH" ? "watch" : "ok"}`}>
                <span className="dot" /> {call.verdict === "CONTINUE" ? "On track" : call.verdict === "WATCH" ? "Watch" : "Stop and fix"}
              </span>
            </span>
          </summary>
          <div className="stack">
            {(call.pilotDay || pilotIssues.length > 0) && (
              <p className="muted small">
                {call.pilotDay && <>Day {call.pilotDay} of {PILOT.lengthDays}. </>}
                {pilotIssues.map((c) => `${c.name}: ${c.value}`).join(" · ")}
              </p>
            )}
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Now</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {call.checks.map((c) => (
                    <tr key={c.name}>
                      <td>
                        {c.name}
                        <div className="faint small">{c.gate} gate · limit {c.limit}</div>
                      </td>
                      <td className="small">{c.value}</td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          <details className="card pin">
            <summary>
              <span className="row" style={{ gap: 10 }}>
                <h2>Notes on this data</h2>
                <span className="chip-soft">{run.warnings.length}</span>
              </span>
            </summary>
            <ul className="warn-list muted small">
              {run.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
