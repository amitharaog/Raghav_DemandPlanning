import Link from "next/link";
import { notFound } from "next/navigation";
import { int, num, pctChange } from "@/lib/format";
import { getRecommendations, getRun } from "@/lib/queries";
import { FLAGS } from "@/lib/rules";
import { FlagBadge } from "../../../components/Badges";

export const dynamic = "force-dynamic";

export default async function TrendsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(Number(id));
  if (!run) notFound();
  const recs = run.status === "completed" ? await getRecommendations(run.id) : [];
  const festival = recs[0]?.numbers.isFestivalMonth;
  const samples = FLAGS.map((f) => recs.find((r) => r.flag === f)).filter((r): r is (typeof recs)[number] => !!r);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Trends · run #{run.id}</p>
          <h1>The numbers behind each result</h1>
          <div className="meta">
            {festival && <span className="chip-soft">Festival month · expected demand = 4-week average ×1.25</span>}
            <span className="faint small">Weeks of stock = (stock in hand + on order) ÷ expected weekly demand</span>
          </div>
        </div>
        <Link className="btn" href={`/runs/${run.id}`}>Back to review</Link>
      </div>

      {samples.length > 0 && (
        <section>
          <div className="section-title">
            <h2>One example per flag</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Result</th>
                  <th className="n">4-wk avg</th>
                  <th className="n">12-wk avg</th>
                  <th className="n">Change</th>
                  <th className="n">Weeks of stock</th>
                  <th>Healthy range</th>
                  <th className="n">Qty</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.skuId}</b><div className="faint small">{r.skuName}</div></td>
                    <td><FlagBadge flag={r.flag} /></td>
                    <td className="n">{num(r.numbers.avg4)}</td>
                    <td className="n">{num(r.numbers.avg12)}</td>
                    <td className="n">{pctChange(r.numbers.ratio4to12)}</td>
                    <td className="n"><b>{num(r.numbers.weeksOfStock, 2)}</b></td>
                    <td className="small muted">{r.numbers.stockoutBelow}–{r.numbers.overstockAbove} weeks</td>
                    <td className="n">{r.suggestedQty ?? "Raghav"}</td>
                    <td className="small muted" style={{ maxWidth: 360 }}>{r.ruleFired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="section-title" style={{ marginBottom: -8 }}>
        <h2>All SKUs</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Result</th>
              <th>Perishability</th>
              <th className="n">Weeks of history</th>
              <th className="n">Avg / wk, last 4</th>
              <th className="n">Avg / wk, last 12</th>
              <th className="n">4 vs 12</th>
              <th className="n">Stock in hand</th>
              <th className="n">On order</th>
              <th className="n">Weeks of stock (no uplift)</th>
              <th className="n">Expected / wk</th>
              <th className="n">Weeks of stock</th>
              <th>Missing weeks</th>
            </tr>
          </thead>
          <tbody>
            {recs.map((r) => (
              <tr key={r.id}>
                <td><b>{r.skuId}</b><div className="muted small">{r.skuName}</div></td>
                <td><FlagBadge flag={r.flag} /></td>
                <td>{r.perishability}</td>
                <td className="n">{r.numbers.weeksOfHistory}</td>
                <td className="n">{num(r.numbers.avg4)}</td>
                <td className="n">{num(r.numbers.avg12)}</td>
                <td className="n">{pctChange(r.numbers.ratio4to12)}</td>
                <td className="n">{r.numbers.stockOnHand === null ? "missing" : int(r.numbers.stockOnHand)}</td>
                <td className="n">{int(r.numbers.onOrder)}</td>
                <td className="n">{num(r.numbers.weeksOfStockRaw, 2)}</td>
                <td className="n">{num(r.numbers.forecastWeekly)}</td>
                <td className="n"><b>{num(r.numbers.weeksOfStock, 2)}</b></td>
                <td className="small">{r.numbers.missingWeeks.join(", ") || "–"}</td>
              </tr>
            ))}
            {!recs.length && <tr><td colSpan={13} className="muted">This run has no trends ({run.status}).</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
