import Link from "next/link";
import { istDateTime } from "@/lib/format";
import { listRunStats } from "@/lib/queries";
import { FLAG_LABEL, FLAGS } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const runs = await listRunStats(200);
  return (
    <div className="stack">
      <div>
        <h1>Run history</h1>
        <p className="muted">Every run, scheduled or manual. Overrides = rule results Raghav changed or held.</p>
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
              <th className="n">SKUs</th>
              {FLAGS.map((f) => <th key={f} className="n">{FLAG_LABEL[f]}</th>)}
              <th className="n">Decided</th>
              <th className="n">Overrides</th>
              <th className="n">Held</th>
              <th className="n">Zoho CSVs</th>
              <th>Reasons</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.status === "completed" ? <Link href={`/runs/${r.id}`}>#{r.id}</Link> : `#${r.id}`}</td>
                <td>{r.runDate}</td>
                <td>{istDateTime(r.startedAt)}</td>
                <td>{r.trigger}</td>
                <td>{r.status}</td>
                <td className="n">{r.skuCount ?? "–"}</td>
                {FLAGS.map((f) => <td key={f} className="n">{r.flagCounts?.[f] ?? "–"}</td>)}
                <td className="n">{r.status === "completed" ? `${r.decided}/${r.skuCount}` : "–"}</td>
                <td className="n">{r.status === "completed" ? r.overrides : "–"}</td>
                <td className="n">{r.status === "completed" ? r.held : "–"}</td>
                <td className="n">{r.zohoExports}</td>
                <td className="small">{r.reasonsReport ? (r.reasonsReport.mode === "llm" ? "Claude" : "templates") : "–"}</td>
                <td className="small" style={{ maxWidth: 360 }}>{r.haltReasons[0] ?? r.error ?? ""}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={17} className="muted">No runs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
