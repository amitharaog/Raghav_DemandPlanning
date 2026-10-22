import Link from "next/link";
import { notFound } from "next/navigation";
import { int, num, pctChange } from "@/lib/format";
import { getRecommendations, getRun } from "@/lib/queries";
import { FlagBadge } from "../../../components/Badges";

export const dynamic = "force-dynamic";

export default async function TrendsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(Number(id));
  if (!run) notFound();
  const recs = run.status === "completed" ? await getRecommendations(run.id) : [];
  const festival = recs[0]?.numbers.isFestivalMonth;

  return (
    <div className="stack">
      <div>
        <h1>Trends · run #{run.id}</h1>
        <p className="muted">
          Run date {run.runDate} · {festival ? "Festival month (Oct/Nov/Mar): expected demand = 4-wk avg × 1.25" : "Not a festival month"} ·
          weeks of stock = (stock in hand + stock on order) ÷ weekly sales · <Link href={`/runs/${run.id}`}>Review</Link>
        </p>
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
