import Link from "next/link";
import { getPool } from "@/lib/db";
import { int, istDateTime, nextScheduledRun, num, pctChange } from "@/lib/format";
import { killCall, PILOT } from "@/lib/killCriteria";
import {
  getLatestCompletedRunId,
  getRecommendations,
  getRun,
  listPilotOutcomes,
  listRunStats,
  listZohoExports,
  statsFor,
  type RecRow,
} from "@/lib/queries";
import { ACTION_LABEL, FLAG_LABEL, FLAGS } from "@/lib/rules";
import { mondayToIsoWeek, todayIST } from "@/lib/weeks";
import { FlagBadge, StatusBadge } from "./components/Badges";
import { PilotOutcomeForm } from "./components/PilotOutcomeForm";
import { RunNowButton } from "./components/RunNowButton";
import { ZohoExportButton } from "./components/ZohoExportButton";

export const dynamic = "force-dynamic";

async function sapStatus() {
  const db = getPool();
  const load = (await db.query(`select id, loaded_at, source_dir, row_counts, rejected from load_batches order by id desc limit 1`)).rows[0];
  const latestWeek = (await db.query(`select max(week_start) as w from weekly_sales`)).rows[0]?.w as string | null;
  const stockAsOf = (await db.query(`select max(as_of_date) as d from inventory_snapshots`)).rows[0]?.d as string | null;
  const skus = (await db.query(`select count(*)::int as n from skus`)).rows[0].n as number;
  return { load, latestWeek, stockAsOf, skus };
}

/** One example SKU per flag, for the "numbers behind each result" panel. */
function samples(recs: RecRow[]): RecRow[] {
  return FLAGS.map((f) => recs.find((r) => r.flag === f)).filter((r): r is RecRow => !!r);
}

export default async function Dashboard() {
  const [sap, runs, outcomes, latestCompletedId] = await Promise.all([
    sapStatus(),
    listRunStats(50),
    listPilotOutcomes(),
    getLatestCompletedRunId(),
  ]);
  const latest = runs[0] ?? null;
  const reviewRun = latestCompletedId ? await getRun(latestCompletedId) : null;
  const recs = reviewRun ? await getRecommendations(reviewRun.id) : [];
  const exports = reviewRun ? await listZohoExports(reviewRun.id) : [];
  const stats = reviewRun ? statsFor(reviewRun, recs, exports.length) : null;
  const call = killCall(runs, outcomes, todayIST());
  const pending = stats ? recs.length - stats.decided : 0;
  const reasonsMode = reviewRun?.reasonsReport?.mode === "llm" ? `Claude (${reviewRun.reasonsReport.model})` : "Templates";

  return (
    <div className="stack">
      <div className="row spread">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            SAP → Excel → Trends → Forecast → Raghav&apos;s call → Zoho. Runs Mon &amp; Thu 06:00 IST; next:{" "}
            <b>{istDateTime(nextScheduledRun().toISOString())} IST</b>.
          </p>
        </div>
        <RunNowButton defaultDate={todayIST()} />
      </div>

      <section className={`banner ${call.verdict}`}>
        <div className="row spread">
          <div>
            <span className="verdict">KILL CALL: {call.verdict}</span> <span className="muted">· {call.headline}</span>
          </div>
          <span className="muted small">
            {call.pilotDay ? `Pilot day ${call.pilotDay} of ${PILOT.lengthDays}` : "Pilot not started"}
          </span>
        </div>
      </section>

      {latest && latest.status !== "completed" && (
        <section className="banner KILL">
          <b>
            Latest run #{latest.id} ({latest.runDate}) {latest.status === "halted" ? "was halted by the data checks" : "failed"}.
          </b>{" "}
          Nothing from it was published. {reviewRun && `Raghav's review still shows run #${reviewRun.id}.`}
          <ul className="warn-list">
            {(latest.haltReasons.length ? latest.haltReasons : [latest.error]).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Pipeline {reviewRun && <span className="muted small">· run #{reviewRun.id}, run date {reviewRun.runDate}</span>}</h2>
        <div className="pipeline">
          <div className="stage">
            <div className="n">1 · Input</div>
            <div className="t">SAP</div>
            <div className="v">{int(sap.skus)} SKUs</div>
            <div className="d">
              Sales to {sap.latestWeek ? mondayToIsoWeek(sap.latestWeek) : "–"} · stock as of {sap.stockAsOf ?? "–"}
              <br />
              {sap.load ? `Load #${sap.load.id}, ${sap.load.rejected.length} rows rejected` : "Not loaded"}
            </div>
          </div>
          <div className="stage">
            <div className="n">2 · Extract</div>
            <div className="t">Excel</div>
            <div className="v">{reviewRun?.hasExtract ? "Ready" : "–"}</div>
            <div className="d">
              {reviewRun?.hasExtract ? (
                <a href={`/api/runs/${reviewRun.id}/extract`}>Download .xlsx</a>
              ) : (
                "No run yet"
              )}
              <br />
              Sales by week, stock, open POs, SKU attributes
            </div>
          </div>
          <div className="stage">
            <div className="n">3 · Trends</div>
            <div className="t">4 vs 12 weeks</div>
            <div className="v">{recs.length || "–"}</div>
            <div className="d">
              {recs[0] ? (recs[0].numbers.isFestivalMonth ? "Festival month: ×1.25 uplift" : "Not a festival month") : "–"}
              <br />
              {reviewRun && <Link href={`/runs/${reviewRun.id}/trends`}>See all numbers</Link>}
            </div>
          </div>
          <div className="stage">
            <div className="n">4 · Forecast</div>
            <div className="t">Raghav&apos;s rules</div>
            <div className="v">{stats ? `${stats.flagCounts?.JUDGMENT ?? 0} to judge` : "–"}</div>
            <div className="d">
              {stats ? `${recs.length - (stats.flagCounts?.JUDGMENT ?? 0)} rule-based` : "–"}
              <br />
              Reasons: {reasonsMode}
            </div>
          </div>
          <div className="stage manual">
            <div className="n">5 · Manual</div>
            <div className="t">Raghav&apos;s call</div>
            <div className="v">{stats ? `${stats.decided}/${recs.length}` : "–"}</div>
            <div className="d">
              {stats ? `${pending} pending · ${stats.overrides} overrides · ${stats.held} held` : "–"}
              <br />
              {reviewRun && <Link href={`/runs/${reviewRun.id}`}>Open review</Link>}
            </div>
          </div>
          <div className="stage">
            <div className="n">6 · Output</div>
            <div className="t">Zoho POs</div>
            <div className="v">{stats ? `${stats.poLines} lines` : "–"}</div>
            <div className="d">
              {exports[0] ? (
                <a href={`/api/zoho-exports/${exports[0].id}`}>
                  Last CSV: {exports[0].poCount} POs, {istDateTime(exports[0].createdAt)}
                </a>
              ) : (
                "Approved items only"
              )}
              <br />
              {reviewRun && <ZohoExportButton runId={reviewRun.id} disabled={!stats?.poLines} compact />}
            </div>
          </div>
        </div>
      </section>

      {reviewRun && (
        <section>
          <h2>Recommendations by flag</h2>
          <div className="tiles">
            {FLAGS.map((f) => (
              <Link key={f} className="tile" href={`/runs/${reviewRun.id}?flag=${f}`}>
                <FlagBadge flag={f} />
                <div className="v">{reviewRun.flagCounts?.[f] ?? 0}</div>
                <div className="muted small">
                  {recs.filter((r) => r.flag === f && !r.decision).length} awaiting Raghav
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {reviewRun && reviewRun.warnings.length > 0 && (
        <section className="card">
          <h3>Warnings on run #{reviewRun.id}</h3>
          <ul className="warn-list">
            {reviewRun.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {recs.length > 0 && (
        <section>
          <h2>One SKU per flag: the numbers behind each result</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Flag</th>
                  <th className="n">4-wk avg</th>
                  <th className="n">12-wk avg</th>
                  <th className="n">Change</th>
                  <th className="n">Stock + on order</th>
                  <th className="n">Expected / wk</th>
                  <th className="n">Weeks of stock</th>
                  <th>Limits</th>
                  <th>Action</th>
                  <th className="n">Qty</th>
                  <th>Rule fired</th>
                </tr>
              </thead>
              <tbody>
                {samples(recs).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.skuId}</b>
                      <div className="muted small">{r.skuName}</div>
                    </td>
                    <td>
                      <FlagBadge flag={r.flag} />
                    </td>
                    <td className="n">{num(r.numbers.avg4)}</td>
                    <td className="n">{num(r.numbers.avg12)}</td>
                    <td className="n">{pctChange(r.numbers.ratio4to12)}</td>
                    <td className="n">
                      {r.numbers.stockOnHand === null ? "missing" : int(r.numbers.stockOnHand + r.numbers.onOrder)}
                    </td>
                    <td className="n">{num(r.numbers.forecastWeekly)}</td>
                    <td className="n">
                      <b>{num(r.numbers.weeksOfStock, 2)}</b>
                    </td>
                    <td className="small">
                      {r.perishability === "High" ? "Perishable " : ""}
                      {r.numbers.stockoutBelow}–{r.numbers.overstockAbove} wks
                    </td>
                    <td>{ACTION_LABEL[r.action as keyof typeof ACTION_LABEL]}</td>
                    <td className="n">{r.suggestedQty ?? "Raghav"}</td>
                    <td className="small">{r.ruleFired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="grid cols-2">
        <div className="card">
          <h2>Kill criteria</h2>
          <table>
            <thead>
              <tr>
                <th>Gate</th>
                <th>Check</th>
                <th>Now</th>
                <th>Limit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {call.checks.map((c) => (
                <tr key={c.name}>
                  <td>{c.gate}</td>
                  <td>
                    {c.name}
                    <div className="muted small">{c.detail}</div>
                  </td>
                  <td>{c.value}</td>
                  <td className="small">{c.limit}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>
            Data gate halts a single run. AI gate switches the LLM off (reasons fall back to templates; quantities are
            never affected). Pilot gate stops the pilot.
          </p>
        </div>
        <div className="card">
          <h2>Business outcome vs the case study</h2>
          <div className="kv" style={{ marginBottom: 12 }}>
            <span className="muted">Stockout lost sales</span>
            <span>
              ₹{PILOT.baselineLossLakh.stockoutLow}–{PILOT.baselineLossLakh.stockoutHigh} lakh / quarter
            </span>
            <span className="muted">Perishable write-offs</span>
            <span>
              ₹{PILOT.baselineLossLakh.writeoffLow}–{PILOT.baselineLossLakh.writeoffHigh} lakh / quarter
            </span>
            <span className="muted">Baseline total</span>
            <span>
              <b>
                ₹{PILOT.baselineLossLakh.low}–{PILOT.baselineLossLakh.high} lakh / quarter
              </b>
            </span>
            <span className="muted">Pilot budget</span>
            <span>₹{PILOT.budgetLakh} lakh, 90 days</span>
            <span className="muted">Kill if</span>
            <span>loss falls less than {PILOT.minLossReduction * 100}% by day 90</span>
          </div>
          <PilotOutcomeForm />
          {outcomes.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="n">Stockouts ₹L</th>
                  <th className="n">Write-offs ₹L</th>
                  <th className="n">Total ₹L</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.id}>
                    <td>{o.periodLabel}</td>
                    <td className="n">{num(Number(o.stockoutLossLakh))}</td>
                    <td className="n">{num(Number(o.writeoffLossLakh))}</td>
                    <td className="n">{num(Number(o.stockoutLossLakh) + Number(o.writeoffLossLakh))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <div className="row spread">
          <h2>Recent runs</h2>
          <Link href="/history">Full history</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Run date</th>
                <th>Started (IST)</th>
                <th>Trigger</th>
                <th>Status</th>
                {FLAGS.map((f) => (
                  <th key={f} className="n">
                    {FLAG_LABEL[f]}
                  </th>
                ))}
                <th className="n">Overrides</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td>{r.status === "completed" ? <Link href={`/runs/${r.id}`}>#{r.id}</Link> : `#${r.id}`}</td>
                  <td>{r.runDate}</td>
                  <td>{istDateTime(r.startedAt)}</td>
                  <td>{r.trigger}</td>
                  <td>{r.status}</td>
                  {FLAGS.map((f) => (
                    <td key={f} className="n">
                      {r.flagCounts?.[f] ?? "–"}
                    </td>
                  ))}
                  <td className="n">{r.status === "completed" ? r.overrides : "–"}</td>
                </tr>
              ))}
              {!runs.length && (
                <tr>
                  <td colSpan={11} className="muted">
                    No runs yet. Load the SAP export (npm run load) and press Run now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
