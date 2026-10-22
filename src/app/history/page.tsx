import Link from "next/link";
import { istDateTime } from "@/lib/format";
import { listRunStats } from "@/lib/queries";
import { FLAG_LABEL, FLAGS } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const runs = await listRunStats(200);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">History</p>
          <h1>Every run</h1>
          <div className="meta">
            <span className="faint small">Scheduled Mon and Thu at 06:00 IST, plus any Run now. Overrides are rule results Raghav changed or held.</span>
          </div>
        </div>
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
              {FLAGS.map((f) => <th key={f} className="n">{FLAG_LABEL[f]}</th>)}
              <th className="n">Decided</th>
              <th className="n">Overrides</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.status === "completed" ? <Link href={`/runs/${r.id}`}>#{r.id}</Link> : `#${r.id}`}</td>
                <td>{r.runDate}</td>
                <td>{istDateTime(r.startedAt)}</td>
                <td className="muted">{r.trigger === "schedule" ? "Scheduled" : r.trigger === "manual" ? "Run now" : "Setup"}</td>
                <td><span className={`pill ${r.status === "completed" ? "s-ok" : "s-kill"}`}><span className="dot" />{r.status === "completed" ? "Completed" : r.status === "halted" ? "Stopped" : "Failed"}</span></td>
                {FLAGS.map((f) => <td key={f} className="n">{r.flagCounts?.[f] ?? "–"}</td>)}
                <td className="n">{r.status === "completed" ? `${r.decided}/${r.skuCount}` : "–"}</td>
                <td className="n">{r.status === "completed" ? r.overrides : "–"}</td>
                <td className="small muted" style={{ maxWidth: 360 }}>{r.haltReasons[0] ?? r.error ?? ""}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={13} className="muted">No runs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
