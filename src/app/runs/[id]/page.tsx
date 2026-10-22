import Link from "next/link";
import { notFound } from "next/navigation";
import { istDateTime } from "@/lib/format";
import { getLatestCompletedRunId, getRecommendations, getRun, listZohoExports, statsFor } from "@/lib/queries";
import { FLAGS, type Flag } from "@/lib/rules";
import { ReviewTable, type FlagFilter } from "../../components/ReviewTable";
import { ZohoExportButton } from "../../components/ZohoExportButton";

export const dynamic = "force-dynamic";

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flag?: string; pending?: string }>;
}) {
  const { id } = await params;
  const { flag, pending } = await searchParams;
  const run = await getRun(Number(id));
  if (!run) notFound();
  if (run.status !== "completed") {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">Run #{run.id}</p>
            <h1>This run was {run.status === "halted" ? "stopped by the data checks" : "not completed"}</h1>
          </div>
        </div>
        <div className="banner KILL">
          <span className="ico">!</span>
          <ul className="warn-list">
            {(run.haltReasons.length ? run.haltReasons : [run.error]).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
        <p className="muted">
          Nothing from this run was published. <Link href="/review">Go to the latest plan</Link>
        </p>
      </div>
    );
  }
  const [recs, exports, latestId] = await Promise.all([getRecommendations(run.id), listZohoExports(run.id), getLatestCompletedRunId()]);
  const stats = statsFor(run, recs, exports.length);
  const editable = latestId === run.id;
  const initialFlag: FlagFilter | null = flag === "ORDER" ? "ORDER" : FLAGS.includes(flag as Flag) ? (flag as Flag) : null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Raghav&apos;s review · run #{run.id}</p>
          <h1>Plan for {longDate(run.runDate)}</h1>
          <div className="meta">
            <span className="chip-soft">
              {stats.decided} of {recs.length} decided
            </span>
            {stats.overrides > 0 && <span className="chip-soft">{stats.overrides} overrides</span>}
            <a className="small" href={`/api/runs/${run.id}/extract`}>Excel extract</a>
            <Link className="small" href={`/runs/${run.id}/trends`}>Trends</Link>
          </div>
        </div>
        <div className="stack-sm" style={{ justifyItems: "end" }}>
          <ZohoExportButton runId={run.id} disabled={!stats.poLines} />
          <span className="faint small">
            {stats.poLines ? `${stats.poLines} approved lines will go to Zoho` : "Approve items to create purchase orders"}
          </span>
          {exports[0] && (
            <a className="small" href={`/api/zoho-exports/${exports[0].id}`}>
              Last CSV, {istDateTime(exports[0].createdAt)}
            </a>
          )}
        </div>
      </div>
      {!editable && (
        <div className="banner WATCH">
          <span className="ico">i</span>
          <span>
            A newer plan exists, so this one is read-only. <Link href="/review">Open the latest plan</Link>
          </span>
        </div>
      )}
      <ReviewTable runId={run.id} recs={recs} editable={editable} initialFlag={initialFlag} initialPending={pending === "1"} />
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
