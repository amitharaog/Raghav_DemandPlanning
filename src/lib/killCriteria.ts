// The kill call. Three gates, each with a fixed limit agreed up front:
//
//   Data  - per run: bad or stale SAP data halts the run (see checks.ts).
//   AI    - the LLM only writes reasons; if they are wrong, switch it off and
//           keep running on templates. The rules are unaffected.
//   Pilot - does the tool actually fit Raghav's work and cut the losses in the
//           case study (Rs 28-34 lakh per quarter)? If not, stop the pilot.

import type { PilotOutcome, RunStats } from "./queries";
import { daysBetween } from "./weeks";

export const PILOT = {
  lengthDays: 90,
  budgetLakh: 15,
  /** Case study: stockouts Rs 18-22 lakh + perishable write-offs Rs 10-12 lakh, per quarter. */
  baselineLossLakh: { low: 28, high: 34, stockoutLow: 18, stockoutHigh: 22, writeoffLow: 10, writeoffHigh: 12 },
  /** Raghav says the rules cover 80-85% of his calls. */
  maxOverrideRate: 0.3,
  maxJudgmentShare: 0.3,
  maxReasonWrongRate: 0.1,
  minLossReduction: 0.15,
  /** Halted runs in a row that mean the data feed itself is not working. */
  maxConsecutiveHalts: 2,
  /** Too few decisions to judge override rate below this. */
  minDecisionsToJudge: 10,
} as const;

export type GateStatus = "ok" | "watch" | "kill" | "no-data";
export type Check = { gate: "Data" | "AI" | "Pilot"; name: string; value: string; limit: string; status: GateStatus; detail: string };
export type KillCall = { verdict: "CONTINUE" | "WATCH" | "KILL"; headline: string; pilotDay: number | null; checks: Check[] };

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const near = (value: number, limit: number) => value > limit * 0.8;

export function killCall(runs: RunStats[], outcomes: PilotOutcome[], today: string): KillCall {
  const checks: Check[] = [];
  const ordered = [...runs].sort((a, b) => a.id - b.id);
  const completed = ordered.filter((r) => r.status === "completed");
  const pilotDay = ordered.length ? daysBetween(ordered[0].runDate, today) + 1 : null;

  // Data gate
  let streak = 0;
  for (const r of [...ordered].reverse()) {
    if (r.status === "halted" || r.status === "failed") streak++;
    else break;
  }
  const last = ordered[ordered.length - 1];
  checks.push({
    gate: "Data",
    name: "Data checks on the latest run",
    value: last ? last.status : "no runs",
    limit: "completed",
    status: !last ? "no-data" : last.status === "completed" ? "ok" : streak >= PILOT.maxConsecutiveHalts ? "kill" : "watch",
    detail: !last
      ? "No run yet."
      : last.status === "completed"
        ? "Stock, sales and master data were fresh and complete."
        : `${streak} run(s) in a row halted or failed. ${last.haltReasons[0] ?? last.error ?? ""}`,
  });

  // AI gate
  const llmRuns = completed.filter((r) => r.reasonsReport?.mode === "llm" || r.reasonsReport?.killed);
  const tripped = completed.filter((r) => r.reasonsReport?.killed).length;
  const reasonsReviewed = completed.reduce((n, r) => n + r.decided, 0);
  const wrong = completed.reduce((n, r) => n + r.reasonsMarkedWrong, 0);
  const wrongRate = reasonsReviewed ? wrong / reasonsReviewed : 0;
  checks.push({
    gate: "AI",
    name: "Reasons Raghav marked wrong",
    value: reasonsReviewed ? `${wrong} of ${reasonsReviewed} (${pct(wrongRate)})` : "none reviewed",
    limit: `<= ${pct(PILOT.maxReasonWrongRate)}`,
    status: !reasonsReviewed ? "no-data" : wrongRate > PILOT.maxReasonWrongRate ? "kill" : near(wrongRate, PILOT.maxReasonWrongRate) ? "watch" : "ok",
    detail:
      wrongRate > PILOT.maxReasonWrongRate
        ? "Switch the LLM off (LLM_REASONS=off). Rules and quantities keep working on template reasons."
        : "Reasons are written by the LLM but never set quantities.",
  });
  checks.push({
    gate: "AI",
    name: "Runs where the AI check rejected the LLM's reasons",
    value: llmRuns.length ? `${tripped} of ${llmRuns.length}` : "LLM not used yet",
    limit: "0",
    status: !llmRuns.length ? "no-data" : tripped ? "watch" : "ok",
    detail: llmRuns.length
      ? "A run trips this when over 10% of reasons quote numbers that are not in the rule result."
      : (completed[completed.length - 1]?.reasonsReport?.note ?? "Template reasons in use."),
  });

  // Pilot gate: rules fit
  const ruleDecided = completed.reduce((n, r) => n + r.ruleBasedDecided, 0);
  const overrides = completed.reduce((n, r) => n + r.overrides, 0);
  const overrideRate = ruleDecided ? overrides / ruleDecided : 0;
  checks.push({
    gate: "Pilot",
    name: "Rule results Raghav changed or held",
    value: ruleDecided ? `${overrides} of ${ruleDecided} (${pct(overrideRate)})` : "no decisions yet",
    limit: `<= ${pct(PILOT.maxOverrideRate)}`,
    status:
      ruleDecided < PILOT.minDecisionsToJudge
        ? "no-data"
        : overrideRate > PILOT.maxOverrideRate
          ? "kill"
          : near(overrideRate, PILOT.maxOverrideRate)
            ? "watch"
            : "ok",
    detail: "Raghav says his rules cover 80-85% of his calls. Above 30% means the written rules don't match how he decides.",
  });
  const skus = completed.reduce((n, r) => n + (r.skuCount ?? 0), 0);
  const judgment = completed.reduce((n, r) => n + (r.flagCounts?.JUDGMENT ?? 0), 0);
  const judgmentShare = skus ? judgment / skus : 0;
  checks.push({
    gate: "Pilot",
    name: "SKUs sent to Raghav's judgment",
    value: skus ? `${judgment} of ${skus} (${pct(judgmentShare)})` : "no runs yet",
    limit: `<= ${pct(PILOT.maxJudgmentShare)}`,
    status: !skus ? "no-data" : judgmentShare > PILOT.maxJudgmentShare ? "kill" : near(judgmentShare, PILOT.maxJudgmentShare) ? "watch" : "ok",
    detail: "Expected 15-20%. Far above that and the tool saves Raghav little time.",
  });

  // Pilot gate: business outcome
  const latest = outcomes[0];
  const mid = (PILOT.baselineLossLakh.low + PILOT.baselineLossLakh.high) / 2;
  if (latest) {
    const total = Number(latest.stockoutLossLakh) + Number(latest.writeoffLossLakh);
    const reduction = 1 - total / mid;
    checks.push({
      gate: "Pilot",
      name: `Loss vs baseline (${latest.periodLabel})`,
      value: `₹${total.toFixed(1)}L (${reduction >= 0 ? "-" : "+"}${pct(Math.abs(reduction))})`,
      limit: `>= ${pct(PILOT.minLossReduction)} below ₹${mid}L`,
      status: reduction >= PILOT.minLossReduction ? "ok" : pilotDay !== null && pilotDay < PILOT.lengthDays ? "watch" : "kill",
      detail:
        `Baseline ₹${PILOT.baselineLossLakh.low}-${PILOT.baselineLossLakh.high}L/quarter (stockouts + write-offs). ` +
        `15% ≈ ₹${(mid * PILOT.minLossReduction).toFixed(1)}L/quarter, which repays the ₹${PILOT.budgetLakh}L budget within a year.`,
    });
  } else {
    checks.push({
      gate: "Pilot",
      name: "Loss vs baseline",
      value: "not entered",
      limit: `>= ${pct(PILOT.minLossReduction)} below ₹${mid}L`,
      status: "no-data",
      detail: `Finance enters the quarter's stockout and write-off losses at day 45 and day 90. Baseline ₹${PILOT.baselineLossLakh.low}-${PILOT.baselineLossLakh.high}L/quarter.`,
    });
  }

  const pilotChecks = checks.filter((c) => c.gate !== "AI");
  const verdict: KillCall["verdict"] = pilotChecks.some((c) => c.status === "kill")
    ? "KILL"
    : checks.some((c) => c.status === "watch" || c.status === "kill")
      ? "WATCH"
      : "CONTINUE";
  const killers = checks.filter((c) => c.status === "kill").map((c) => c.name.toLowerCase());
  const headline =
    verdict === "KILL"
      ? `Stop and fix before the next run: ${killers.join("; ")}.`
      : verdict === "WATCH"
        ? "Running, but one or more limits are close or tripped. See below."
        : checks.every((c) => c.status === "no-data")
          ? "Not enough data for a call yet."
          : "All limits met. Keep the pilot running.";
  return { verdict, headline, pilotDay, checks };
}
