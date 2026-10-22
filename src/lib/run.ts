// One forecast run: SAP data -> Excel extract -> data checks -> trends -> rules
// -> reasons -> saved for Raghav's review. Used by "Run now", the Mon/Thu
// schedule and the CLI, so all three behave identically.

import { dataChecks } from "./checks";
import { getPool } from "./db";
import { buildExtract } from "./extract";
import { reasonsClientFromEnv, writeReasons } from "./reasons";
import { applyRules, FLAGS, type Flag } from "./rules";
import { readSnapshot } from "./snapshot";
import { computeTrend } from "./trends";
import { parseDate, todayIST } from "./weeks";

const RUN_LOCK = 482_017; // pg advisory lock id: one run at a time

export type RunOutcome = { runId: number; status: "completed" | "halted" | "failed"; message: string };

export function resolveRunDate(explicit?: string | null): string {
  const d = explicit?.trim() || process.env.RUN_DATE_OVERRIDE?.trim() || todayIST();
  parseDate(d);
  return d;
}

export async function executeRun(opts: {
  runDate?: string | null;
  trigger: "manual" | "schedule" | "cli";
  triggeredBy?: string;
}): Promise<RunOutcome> {
  const runDate = resolveRunDate(opts.runDate);
  const pool = getPool();
  const lockClient = await pool.connect();
  try {
    const { rows: lock } = await lockClient.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [RUN_LOCK]);
    if (!lock[0].ok) throw new Error("Another run is in progress. Try again in a minute.");

    const { rows } = await pool.query<{ id: number }>(
      `insert into runs (run_date, trigger, triggered_by, status) values ($1, $2, $3, 'running') returning id`,
      [runDate, opts.trigger, opts.triggeredBy ?? null],
    );
    const runId = rows[0].id;

    try {
      const snap = await readSnapshot(runDate);
      const prev = (
        await pool.query(
          `select sales_rows_in_window from runs where status = 'completed' and id <> $1 order by id desc limit 1`,
          [runId],
        )
      ).rows[0];
      const checks = dataChecks(snap, prev ? { salesRowsInWindow: prev.sales_rows_in_window } : null);
      const extract = await buildExtract(snap, [...checks.halts.map((h) => `HALTED: ${h}`), ...checks.warnings]);

      if (checks.halts.length) {
        await pool.query(
          `update runs set status = 'halted', finished_at = now(), halt_reasons = $2, warnings = $3, sku_count = $4,
                  sales_rows_in_window = $5, load_batch_id = $6, extract_xlsx = $7 where id = $1`,
          [runId, JSON.stringify(checks.halts), JSON.stringify(checks.warnings), snap.skus.length,
            checks.salesRowsInWindow, snap.latestLoad?.id ?? null, extract],
        );
        return { runId, status: "halted", message: checks.halts.join(" ") };
      }

      const items = snap.skus.map((sku) => ({ sku, rec: applyRules(sku, computeTrend(snap, sku)) }));
      const llm = reasonsClientFromEnv();
      const { reasons, report } = await writeReasons(items, { client: llm.client, model: llm.model, disabledNote: llm.note });

      const flagCounts = Object.fromEntries(FLAGS.map((f) => [f, 0])) as Record<Flag, number>;
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const { sku, rec } of items) {
          flagCounts[rec.flag]++;
          const reason = reasons.get(rec.skuId)!;
          await client.query(
            `insert into recommendations (run_id, sku_id, sku_name, perishability, unit_of_measure, distributor_id,
               distributor_name, flag, action, suggested_qty, rule_fired, rule_trace, also_flagged, judgment_reasons,
               numbers, reason, reason_source)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [runId, sku.skuId, sku.skuName, sku.perishability, sku.unitOfMeasure, sku.distributorId, sku.distributorName,
              rec.flag, rec.action, rec.suggestedQty, rec.ruleFired, JSON.stringify(rec.ruleTrace),
              JSON.stringify(rec.alsoFlagged), JSON.stringify(rec.judgmentReasons), JSON.stringify(rec.numbers),
              reason.text, reason.source],
          );
        }
        const warnings = [...checks.warnings, ...(report.note ? [report.note] : [])];
        await client.query(
          `update runs set status = 'completed', finished_at = now(), warnings = $2, sku_count = $3, flag_counts = $4,
                  sales_rows_in_window = $5, reasons_report = $6, load_batch_id = $7, extract_xlsx = $8 where id = $1`,
          [runId, JSON.stringify(warnings), items.length, JSON.stringify(flagCounts), checks.salesRowsInWindow,
            JSON.stringify(report), snap.latestLoad?.id ?? null, extract],
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
      return { runId, status: "completed", message: `${items.length} SKUs: ${FLAGS.map((f) => `${f} ${flagCounts[f]}`).join(", ")}` };
    } catch (err) {
      await pool.query(`update runs set status = 'failed', finished_at = now(), error = $2 where id = $1`, [
        runId,
        (err as Error).message,
      ]);
      return { runId, status: "failed", message: (err as Error).message };
    }
  } finally {
    await lockClient.query("select pg_advisory_unlock($1)", [RUN_LOCK]).catch(() => {});
    lockClient.release();
  }
}
