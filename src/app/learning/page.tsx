import Link from "next/link";
import { buildFeedback, FEEDBACK } from "@/lib/feedback";
import { PILOT } from "@/lib/killCriteria";
import { getFeedbackFacts } from "@/lib/queries";
import { FLAG_LABEL } from "@/lib/rules";
import { FlagBadge } from "../components/Badges";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const signed = (x: number | null) => (x === null ? "–" : `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`);
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const AREA_TONE = { Rule: "tone-call", Forecast: "tone-info", SKU: "tone-pause", AI: "tone-order" } as const;

export default async function LearningPage() {
  const fb = buildFeedback(await getFeedbackFacts());
  const f = fb.forecast;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Learning</p>
          <h1>What past runs taught us</h1>
          <div className="meta">
            <span className="chip-soft">{fb.runs} plan{fb.runs === 1 ? "" : "s"}</span>
            <span className="chip-soft">{fb.decisions} decisions by Raghav</span>
            <span className="chip-soft">{f.measured} forecasts checked against sales</span>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>The feedback loop</h2>
            <p className="muted small">Every run is checked twice after the fact. Suggestions are never applied on their own: rules change only when someone edits them.</p>
          </div>
        </div>
        <ol className="loop" style={{ margin: 0, padding: 0 }}>
          <li><b>Rules forecast</b>Expected demand and an order per SKU.</li>
          <li><b>Raghav decides</b>Approve, change or hold, with a reason.</li>
          <li><b>Sales come in</b>The next SAP loads bring what actually sold.</li>
          <li><b>We compare</b>Forecast against sales, rule against Raghav&apos;s call.</li>
          <li><b>Suggest a fix</b>A threshold or SAP quantity to change, with evidence.</li>
          <li><b>Next run</b>Shows Raghav what he did last time on each SKU.</li>
        </ol>
      </section>

      <section aria-labelledby="sugg-title">
        <div className="section-title">
          <h2 id="sugg-title">Suggested changes</h2>
          <span className="faint small">Need at least {FEEDBACK.minDecisions} decisions or {FEEDBACK.minMeasured} measured forecasts</span>
        </div>
        {fb.suggestions.length ? (
          <div className="board">
            {fb.suggestions.map((s) => (
              <article key={s.id} className={`card pin suggestion ${AREA_TONE[s.area]}`} style={{ background: "var(--tone-bg)" }}>
                <span className="tag" style={{ justifySelf: "start", background: "var(--surface)", color: "var(--tone)" }}>{s.area}</span>
                <h2>{s.title}</h2>
                <p className="small muted">{s.detail}</p>
                <div className="change" style={{ background: "var(--surface)" }}>{s.change}</div>
              </article>
            ))}
          </div>
        ) : (
          <div className="card empty">
            Nothing to change yet. As Raghav decides more items and sales arrive after each run, patterns show up here.
          </div>
        )}
      </section>

      <section className="board">
        <div className="card pin">
          <div className="pin-title">
            <h2>Forecast vs what sold</h2>
          </div>
          {f.measured ? (
            <div className="stack-sm">
              <div className="stats">
                <div className="stat">
                  <div className="big-number">{pct(f.error)}</div>
                  <div className="faint small">average miss</div>
                </div>
                <div className="stat">
                  <div className="big-number">{signed(f.bias)}</div>
                  <div className="faint small">{(f.bias ?? 0) >= 0 ? "sold more than expected" : "sold less than expected"}</div>
                </div>
              </div>
              <table>
                <thead>
                  <tr><th>Plan</th><th className="n">SKUs</th><th className="n">Miss</th><th className="n">Bias</th></tr>
                </thead>
                <tbody>
                  {f.byRun.filter((r) => r.measured).map((r) => (
                    <tr key={r.runId}>
                      <td><Link href={`/runs/${r.runId}`}>{shortDate(r.runDate)}</Link></td>
                      <td className="n">{r.measured}</td>
                      <td className="n">{pct(r.error)}</td>
                      <td className="n">{signed(r.bias)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {f.pending > 0 && <p className="faint small">{f.pending} more forecasts are waiting for their sales weeks.</p>}
            </div>
          ) : (
            <p className="muted small">
              Waiting for sales. {f.pending} forecast{f.pending === 1 ? "" : "s"} will be checked once the weeks after each run are loaded from SAP.
            </p>
          )}
        </div>

        {f.misses.length > 0 && (
          <div className="card pin">
            <div className="pin-title">
              <h2>Biggest misses</h2>
            </div>
            <table>
              <thead>
                <tr><th>SKU</th><th className="n">Expected</th><th className="n">Sold</th></tr>
              </thead>
              <tbody>
                {f.misses.map((m) => (
                  <tr key={`${m.skuId}-${m.runDate}`}>
                    <td><b>{m.skuId}</b><div className="faint small">{m.skuName} · {shortDate(m.runDate)}</div></td>
                    <td className="n">{Math.round(m.forecast)}/wk</td>
                    <td className="n"><b style={{ color: m.miss >= 0 ? "var(--info)" : "var(--warning)" }}>{Math.round(m.actual)}/wk</b><div className="faint small">{signed(m.miss)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card pin">
          <div className="pin-title">
            <h2>How Raghav uses each rule</h2>
          </div>
          <div className="stack">
            {fb.rules.filter((r) => r.results).map((r) => {
              const w = (n: number) => `${r.decided ? (n / r.decided) * 100 : 0}%`;
              return (
                <div key={r.flag} className="stack-sm" style={{ gap: 6 }}>
                  <div className="row spread">
                    <FlagBadge flag={r.flag} />
                    <span className="small muted">
                      {r.decided}/{r.results} decided
                      {r.overrideRate !== null && <> · <b style={{ color: r.overrideRate > PILOT.maxOverrideRate ? "var(--critical)" : "var(--text)" }}>{pct(r.overrideRate)} overridden</b></>}
                    </span>
                  </div>
                  <div className="bar" aria-label={`${FLAG_LABEL[r.flag]}: ${r.approved} approved, ${r.changed} changed, ${r.held} held`}>
                    <span style={{ width: w(r.approved), background: "var(--good)" }} />
                    <span style={{ width: w(r.changed), background: "var(--info)" }} />
                    <span style={{ width: w(r.held), background: "var(--warning)" }} />
                  </div>
                  {r.medianQtyRatio !== null && (
                    <span className="faint small">Typical change: {r.medianQtyRatio.toFixed(2)}× the suggested qty</span>
                  )}
                </div>
              );
            })}
            <div className="legend">
              <span><i style={{ background: "var(--good)" }} />Approved</span>
              <span><i style={{ background: "var(--info)" }} />Changed</span>
              <span><i style={{ background: "var(--warning)" }} />Held</span>
            </div>
          </div>
        </div>

        <div className="card pin">
          <div className="pin-title">
            <h2>SKUs Raghav keeps changing</h2>
          </div>
          {fb.skus.length ? (
            <ul className="warn-list small" style={{ listStyle: "none", padding: 0, gap: 10 }}>
              {fb.skus.map((s) => (
                <li key={s.skuId} className="memo">
                  <span className="ico" aria-hidden>↻</span>
                  <span>
                    <b style={{ color: "var(--text)" }}>{s.skuId}</b> {s.skuName}: {s.medianRatio > 1 ? "raised" : "cut"} in {s.runs} runs in a row, to about{" "}
                    {s.medianRatio.toFixed(2)}× the suggestion.
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No SKU has been changed the same way {FEEDBACK.skuStreak} runs in a row.</p>
          )}
        </div>

        <div className="card pin">
          <div className="pin-title">
            <h2>Claude&apos;s reasons</h2>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="big-number">{fb.ai.llmReasons}</div>
              <div className="faint small">written by Claude</div>
            </div>
            <div className="stat">
              <div className="big-number">{fb.ai.markedWrong}</div>
              <div className="faint small">marked wrong ({pct(fb.ai.rate)})</div>
            </div>
          </div>
          <p className="faint small" style={{ marginTop: 10 }}>
            Mark a reason wrong on the review page. Above {pct(PILOT.maxReasonWrongRate)}, switch the LLM off; quantities never depend on it.
          </p>
        </div>
      </section>
    </div>
  );
}
