// Database reads and writes used by the web pages and API routes.

import { getPool, withTransaction } from "./db";
import { goesToPurchaseOrder, isOverride, validateDecision, type Decided, type DecisionInput } from "./decisions";
import type { ReasonsReport } from "./reasons";
import type { Flag, Numbers } from "./rules";
import { buildPurchaseOrderLines, submitPurchaseOrders, type ApprovedLine } from "./zoho";

export type RunRow = {
  id: number;
  runDate: string;
  trigger: string;
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "halted" | "failed";
  haltReasons: string[];
  warnings: string[];
  error: string | null;
  skuCount: number | null;
  flagCounts: Record<Flag, number> | null;
  reasonsReport: ReasonsReport | null;
  hasExtract: boolean;
};

export type RecRow = {
  id: number;
  runId: number;
  skuId: string;
  skuName: string;
  perishability: string;
  unitOfMeasure: string;
  distributorId: string;
  distributorName: string;
  flag: Flag;
  action: string;
  suggestedQty: number | null;
  ruleFired: string;
  ruleTrace: string[];
  alsoFlagged: Flag[];
  judgmentReasons: string[];
  numbers: Numbers;
  reason: string;
  reasonSource: "llm" | "template";
  reasonMarkedWrong: boolean;
  decision: (Decided & { decidedBy: string; decidedAt: string; bulk: boolean }) | null;
  decisionCount: number;
};

const RUN_COLS = `id, run_date, trigger, triggered_by, started_at, finished_at, status, halt_reasons, warnings, error,
  sku_count, flag_counts, reasons_report, extract_xlsx is not null as has_extract`;

function toRun(r: Record<string, any>): RunRow {
  return {
    id: r.id,
    runDate: r.run_date,
    trigger: r.trigger,
    triggeredBy: r.triggered_by,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    status: r.status,
    haltReasons: r.halt_reasons,
    warnings: r.warnings,
    error: r.error,
    skuCount: r.sku_count,
    flagCounts: r.flag_counts,
    reasonsReport: r.reasons_report,
    hasExtract: r.has_extract,
  };
}

export async function getRun(id: number): Promise<RunRow | null> {
  const { rows } = await getPool().query(`select ${RUN_COLS} from runs where id = $1`, [id]);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function getLatestRun(): Promise<RunRow | null> {
  const { rows } = await getPool().query(`select ${RUN_COLS} from runs order by id desc limit 1`);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function getLatestCompletedRunId(): Promise<number | null> {
  const { rows } = await getPool().query(`select id from runs where status = 'completed' order by id desc limit 1`);
  return rows[0]?.id ?? null;
}

export async function getExtract(runId: number): Promise<{ runDate: string; xlsx: Buffer } | null> {
  const { rows } = await getPool().query(`select run_date, extract_xlsx from runs where id = $1`, [runId]);
  return rows[0]?.extract_xlsx ? { runDate: rows[0].run_date, xlsx: rows[0].extract_xlsx } : null;
}

export async function getRecommendations(runId: number): Promise<RecRow[]> {
  const { rows } = await getPool().query(
    `select r.*, d.decision, d.final_qty, d.reason as d_reason, d.decided_by, d.decided_at, d.bulk,
            (select count(*) from decisions x where x.recommendation_id = r.id)::int as decision_count
       from recommendations r
       left join lateral (select * from decisions d where d.recommendation_id = r.id order by d.id desc limit 1) d on true
      where r.run_id = $1
      order by r.sku_id`,
    [runId],
  );
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    skuId: r.sku_id,
    skuName: r.sku_name,
    perishability: r.perishability,
    unitOfMeasure: r.unit_of_measure,
    distributorId: r.distributor_id,
    distributorName: r.distributor_name,
    flag: r.flag,
    action: r.action,
    suggestedQty: r.suggested_qty,
    ruleFired: r.rule_fired,
    ruleTrace: r.rule_trace,
    alsoFlagged: r.also_flagged,
    judgmentReasons: r.judgment_reasons,
    numbers: r.numbers,
    reason: r.reason,
    reasonSource: r.reason_source,
    reasonMarkedWrong: r.reason_marked_wrong,
    decision: r.decision
      ? {
          decision: r.decision,
          finalQty: r.final_qty,
          reason: r.d_reason,
          decidedBy: r.decided_by,
          decidedAt: new Date(r.decided_at).toISOString(),
          bulk: r.bulk,
        }
      : null,
    decisionCount: r.decision_count,
  }));
}

export class UserError extends Error {}

async function assertEditable(runId: number) {
  const latest = await getLatestCompletedRunId();
  if (latest !== runId) {
    throw new UserError("This run has been replaced by a newer run. Decisions can only be made on the latest run.");
  }
}

export async function recordDecision(recId: number, input: DecisionInput, by: string): Promise<void> {
  const { rows } = await getPool().query(`select run_id, flag, suggested_qty from recommendations where id = $1`, [recId]);
  if (!rows[0]) throw new UserError("Recommendation not found.");
  await assertEditable(rows[0].run_id);
  const v = validateDecision({ flag: rows[0].flag, suggestedQty: rows[0].suggested_qty }, input);
  if (!v.ok) throw new UserError(v.error);
  await getPool().query(
    `insert into decisions (recommendation_id, decision, final_qty, reason, decided_by) values ($1,$2,$3,$4,$5)`,
    [recId, v.value.decision, v.value.finalQty, v.value.reason, by],
  );
}

/** Approves every rule-based item that has no decision yet. Judgment items are never bulk-approved. */
export async function bulkApprove(runId: number, by: string): Promise<number> {
  await assertEditable(runId);
  const { rowCount } = await getPool().query(
    `insert into decisions (recommendation_id, decision, final_qty, decided_by, bulk)
     select r.id, 'APPROVE', r.suggested_qty, $2, true
       from recommendations r
      where r.run_id = $1 and r.flag <> 'JUDGMENT' and r.suggested_qty is not null
        and not exists (select 1 from decisions d where d.recommendation_id = r.id)`,
    [runId, by],
  );
  return rowCount ?? 0;
}

export async function setReasonMarkedWrong(recId: number, wrong: boolean): Promise<void> {
  await getPool().query(`update recommendations set reason_marked_wrong = $2 where id = $1`, [recId, wrong]);
}

export function approvedLines(recs: RecRow[]): ApprovedLine[] {
  return recs
    .filter((r) => goesToPurchaseOrder(r.decision))
    .map((r) => ({
      skuId: r.skuId,
      skuName: r.skuName,
      unitOfMeasure: r.unitOfMeasure,
      distributorId: r.distributorId,
      distributorName: r.distributorName,
      quantity: r.decision!.finalQty!,
      decision: r.decision!.decision as "APPROVE" | "CHANGE_QTY",
      decisionReason: r.decision!.reason,
    }));
}

export async function exportToZoho(runId: number, by: string) {
  const run = await getRun(runId);
  if (!run || run.status !== "completed") throw new UserError("Only a completed run can be exported.");
  const lines = buildPurchaseOrderLines(runId, run.runDate, approvedLines(await getRecommendations(runId)));
  if (!lines.length) throw new UserError("No approved orders with a quantity above 0 yet.");
  return submitPurchaseOrders(runId, lines, by);
}

export async function listZohoExports(runId: number) {
  const { rows } = await getPool().query(
    `select id, created_at, created_by, po_count, line_count from zoho_exports where run_id = $1 order by id desc`,
    [runId],
  );
  return rows.map((r) => ({
    id: r.id as number,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by as string,
    poCount: r.po_count as number,
    lineCount: r.line_count as number,
  }));
}

export async function getZohoExport(exportId: number) {
  const { rows } = await getPool().query(`select run_id, csv from zoho_exports where id = $1`, [exportId]);
  return rows[0] ? { runId: rows[0].run_id as number, csv: rows[0].csv as string } : null;
}

export type RunStats = RunRow & {
  decided: number;
  approved: number;
  changed: number;
  held: number;
  overrides: number;
  ruleBasedDecided: number;
  reasonsMarkedWrong: number;
  llmReasons: number;
  zohoExports: number;
  poLines: number;
};

export function statsFor(run: RunRow, recs: RecRow[], zohoExports: number): RunStats {
  const decided = recs.filter((r) => r.decision);
  return {
    ...run,
    decided: decided.length,
    approved: decided.filter((r) => r.decision!.decision === "APPROVE").length,
    changed: decided.filter((r) => r.decision!.decision === "CHANGE_QTY").length,
    held: decided.filter((r) => r.decision!.decision === "HOLD").length,
    overrides: recs.filter((r) => isOverride(r.flag, r.suggestedQty, r.decision)).length,
    ruleBasedDecided: decided.filter((r) => r.flag !== "JUDGMENT").length,
    reasonsMarkedWrong: recs.filter((r) => r.reasonMarkedWrong).length,
    llmReasons: recs.filter((r) => r.reasonSource === "llm").length,
    zohoExports,
    poLines: approvedLines(recs).length,
  };
}

export async function listRunStats(limit = 50): Promise<RunStats[]> {
  const { rows } = await getPool().query(`select ${RUN_COLS} from runs order by id desc limit $1`, [limit]);
  const out: RunStats[] = [];
  for (const r of rows) {
    const run = toRun(r);
    const recs = run.status === "completed" ? await getRecommendations(run.id) : [];
    const exports = (await getPool().query(`select count(*)::int as n from zoho_exports where run_id = $1`, [run.id])).rows[0].n;
    out.push(statsFor(run, recs, exports));
  }
  return out;
}

export type PilotOutcome = { id: number; periodLabel: string; stockoutLossLakh: number; writeoffLossLakh: number; enteredAt: string };

export async function listPilotOutcomes(): Promise<PilotOutcome[]> {
  const { rows } = await getPool().query(`select * from pilot_outcomes order by id desc`);
  return rows.map((r) => ({
    id: r.id,
    periodLabel: r.period_label,
    stockoutLossLakh: r.stockout_loss_lakh,
    writeoffLossLakh: r.writeoff_loss_lakh,
    enteredAt: new Date(r.entered_at).toISOString(),
  }));
}

export async function addPilotOutcome(o: { periodLabel: string; stockoutLossLakh: number; writeoffLossLakh: number }, by: string) {
  if (!o.periodLabel.trim()) throw new UserError("Enter a period, e.g. Q3 FY27.");
  for (const v of [o.stockoutLossLakh, o.writeoffLossLakh]) {
    if (!Number.isFinite(v) || v < 0) throw new UserError("Losses must be numbers of 0 or more (in ₹ lakh).");
  }
  await withTransaction((c) =>
    c.query(
      `insert into pilot_outcomes (period_label, stockout_loss_lakh, writeoff_loss_lakh, entered_by) values ($1,$2,$3,$4)`,
      [o.periodLabel.trim(), o.stockoutLossLakh, o.writeoffLossLakh, by],
    ),
  );
}
