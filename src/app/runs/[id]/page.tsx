import Link from "next/link";
import { notFound } from "next/navigation";
import { istDateTime } from "@/lib/format";
import { getLatestCompletedRunId, getRecommendations, getRun, listZohoExports, statsFor } from "@/lib/queries";
import { FLAGS, type Flag } from "@/lib/rules";
import { ReviewTable } from "../../components/ReviewTable";
import { ZohoExportButton } from "../../components/ZohoExportButton";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flag?: string }>;
}) {
  const { id } = await params;
  const { flag } = await searchParams;
  const run = await getRun(Number(id));
  if (!run) notFound();
  if (run.status !== "completed") {
    return (
      <div className="stack">
        <h1>Run #{run.id} ({run.runDate}) was {run.status}</h1>
        <div className="banner KILL">
          <ul className="warn-list">
            {(run.haltReasons.length ? run.haltReasons : [run.error]).map((h) => <li key={h}>{h}</li>)}
          </ul>
        </div>
        <p>No recommendations were published from this run. <Link href="/">Back to dashboard</Link></p>
      </div>
    );
  }
  const [recs, exports, latestId] = await Promise.all([getRecommendations(run.id), listZohoExports(run.id), getLatestCompletedRunId()]);
  const stats = statsFor(run, recs, exports.length);
  const editable = latestId === run.id;
  const initialFlag = FLAGS.includes(flag as Flag) ? (flag as Flag) : null;

  return (
    <div className="stack">
      <div className="row spread">
        <div>
          <h1>Raghav&apos;s review · run #{run.id}</h1>
          <p className="muted">
            Run date {run.runDate} · started {istDateTime(run.startedAt)} IST · {run.trigger} ·{" "}
            <a href={`/api/runs/${run.id}/extract`}>Excel extract</a> · <Link href={`/runs/${run.id}/trends`}>Trends</Link>
          </p>
          <p className="muted small">
            {stats.decided} of {recs.length} decided · {stats.approved} approved · {stats.changed} qty changed · {stats.held} held ·{" "}
            {stats.overrides} overrides of rule results · {stats.poLines} lines will go to Zoho
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <ZohoExportButton runId={run.id} disabled={!stats.poLines} />
          <div className="muted small" style={{ marginTop: 4 }}>Approved and changed items with qty above 0 only.</div>
          {exports.map((e) => (
            <div key={e.id} className="small">
              <a href={`/api/zoho-exports/${e.id}`}>CSV #{e.id}</a>: {e.poCount} POs, {e.lineCount} lines, {istDateTime(e.createdAt)} by {e.createdBy}
            </div>
          ))}
        </div>
      </div>
      {!editable && (
        <div className="banner WATCH">A newer run exists, so this run is read-only. <Link href="/review">Go to the latest run</Link>.</div>
      )}
      {run.warnings.length > 0 && (
        <details className="card">
          <summary>{run.warnings.length} warning(s) on this run</summary>
          <ul className="warn-list">{run.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
      <ReviewTable runId={run.id} recs={recs} editable={editable} initialFlag={initialFlag} />
    </div>
  );
}
