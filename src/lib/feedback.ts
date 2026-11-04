// The feedback loop. After each run, two things come back:
//
//   1. What actually sold in the weeks after the run, against the demand the rules expected.
//   2. What Raghav did with each rule result: approved it, changed the quantity, or held it.
//
// Both are turned into plain suggestions ("High demand orders are raised ~20% every time:
// try 1.8x instead of 1.5x"). Nothing here changes a rule. Thresholds still live only in
// rules-config.ts and change only when a person edits them, so every run stays explainable.
// Pure functions; the database reads are in queries.ts.

import { PILOT } from "./killCriteria";
import { FLAGS, type Flag } from "./rules";
import { RULES } from "./rules-config";

export type Fact = {
  runId: number;
  runDate: string;
  skuId: string;
  skuName: string;
  flag: Flag;
  suggestedQty: number | null;
  decision: "APPROVE" | "CHANGE_QTY" | "HOLD" | null;
  finalQty: number | null;
  decisionReason: string | null;
  reasonSource: "llm" | "template";
  reasonMarkedWrong: boolean;
  isFestival: boolean;
  /** Demand per week the rules expected (after festival uplift). */
  forecastWeekly: number | null;
  /** Average units per week actually sold in the (up to) 4 weeks after the run. */
  actualWeekly: number | null;
  weeksObserved: number;
};

/** Below these counts a pattern is too thin to act on. */
export const FEEDBACK = {
  minDecisions: 5,
  minMeasured: 8,
  /** A median change of more than this (either way) is a real pattern. */
  qtyDrift: 0.15,
  forecastBias: 0.15,
  /** Same-direction changes on one SKU in this many runs in a row. */
  skuStreak: 2,
} as const;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signedPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;

/** final ÷ suggested for a quantity change; null when there is nothing to compare. */
export function qtyRatio(f: Pick<Fact, "decision" | "suggestedQty" | "finalQty">): number | null {
  if (f.decision !== "CHANGE_QTY" || !f.suggestedQty || f.finalQty === null) return null;
  return f.finalQty / f.suggestedQty;
}

export type RuleFeedback = {
  flag: Flag;
  results: number;
  decided: number;
  approved: number;
  changed: number;
  held: number;
  overrideRate: number | null;
  /** Median final ÷ suggested qty over the changes that had a suggested qty. */
  medianQtyRatio: number | null;
  /** Rule said don't order (pause / OK) but Raghav ordered anyway. */
  orderedAnyway: number;
};

export function ruleFeedback(facts: Fact[]): RuleFeedback[] {
  return FLAGS.map((flag) => {
    const all = facts.filter((f) => f.flag === flag);
    const decided = all.filter((f) => f.decision);
    const changed = decided.filter((f) => f.decision === "CHANGE_QTY");
    const held = decided.filter((f) => f.decision === "HOLD");
    const ratios = changed.map(qtyRatio).filter((r): r is number => r !== null);
    // For judgment items every call is Raghav's own, so "override" doesn't apply.
    const overrides = flag === "JUDGMENT" ? 0 : changed.length + held.length;
    return {
      flag,
      results: all.length,
      decided: decided.length,
      approved: decided.filter((f) => f.decision === "APPROVE").length,
      changed: changed.length,
      held: held.length,
      overrideRate: flag === "JUDGMENT" || !decided.length ? null : overrides / decided.length,
      medianQtyRatio: median(ratios),
      orderedAnyway: changed.filter((f) => !f.suggestedQty && (f.finalQty ?? 0) > 0).length,
    };
  });
}

export type ForecastCheck = {
  measured: number;
  /** Forecasts still waiting for sales weeks to come in. */
  pending: number;
  /** Mean absolute error as a share of the forecast. */
  error: number | null;
  /** (actual − forecast) ÷ forecast, summed: positive means the rules expected too little. */
  bias: number | null;
  festivalBias: number | null;
  byRun: { runId: number; runDate: string; measured: number; error: number | null; bias: number | null }[];
  misses: { skuId: string; skuName: string; runDate: string; forecast: number; actual: number; miss: number }[];
};

function accuracy(rows: Fact[]) {
  const m = rows.filter((f) => (f.forecastWeekly ?? 0) > 0 && f.actualWeekly !== null && f.weeksObserved > 0);
  if (!m.length) return { measured: 0, error: null, bias: null };
  const fc = m.reduce((n, f) => n + f.forecastWeekly!, 0);
  const err = m.reduce((n, f) => n + Math.abs(f.actualWeekly! - f.forecastWeekly!), 0);
  const diff = m.reduce((n, f) => n + (f.actualWeekly! - f.forecastWeekly!), 0);
  return { measured: m.length, error: err / fc, bias: diff / fc };
}

export function forecastCheck(facts: Fact[]): ForecastCheck {
  const withForecast = facts.filter((f) => (f.forecastWeekly ?? 0) > 0);
  const all = accuracy(withForecast);
  const runs = [...new Map(withForecast.map((f) => [f.runId, f.runDate])).entries()].sort((a, b) => a[0] - b[0]);
  return {
    measured: all.measured,
    pending: withForecast.filter((f) => f.actualWeekly === null || f.weeksObserved === 0).length,
    error: all.error,
    bias: all.bias,
    festivalBias: accuracy(withForecast.filter((f) => f.isFestival)).bias,
    byRun: runs.map(([runId, runDate]) => ({ runId, runDate, ...accuracy(withForecast.filter((f) => f.runId === runId)) })),
    misses: withForecast
      .filter((f) => f.actualWeekly !== null && f.weeksObserved > 0)
      .map((f) => ({
        skuId: f.skuId,
        skuName: f.skuName,
        runDate: f.runDate,
        forecast: f.forecastWeekly!,
        actual: f.actualWeekly!,
        miss: (f.actualWeekly! - f.forecastWeekly!) / f.forecastWeekly!,
      }))
      .sort((a, b) => Math.abs(b.miss) - Math.abs(a.miss))
      .slice(0, 5),
  };
}

export type SkuPattern = { skuId: string; skuName: string; runs: number; medianRatio: number; lastQty: number; suggestedQty: number };

/** SKUs whose quantity Raghav changed the same way in the last few runs. */
export function skuPatterns(facts: Fact[]): SkuPattern[] {
  const bySku = new Map<string, Fact[]>();
  for (const f of facts) bySku.set(f.skuId, [...(bySku.get(f.skuId) ?? []), f]);
  const out: SkuPattern[] = [];
  for (const rows of bySku.values()) {
    const decided = rows.filter((f) => f.decision).sort((a, b) => a.runId - b.runId);
    const streak: number[] = [];
    for (const f of [...decided].reverse()) {
      const r = qtyRatio(f);
      if (r === null || Math.abs(r - 1) <= FEEDBACK.qtyDrift) break;
      if (streak.length && Math.sign(r - 1) !== Math.sign(streak[0] - 1)) break;
      streak.push(r);
    }
    if (streak.length >= FEEDBACK.skuStreak) {
      const last = decided[decided.length - 1];
      out.push({
        skuId: last.skuId,
        skuName: last.skuName,
        runs: streak.length,
        medianRatio: median(streak)!,
        lastQty: last.finalQty!,
        suggestedQty: last.suggestedQty!,
      });
    }
  }
  return out.sort((a, b) => b.runs - a.runs || a.skuId.localeCompare(b.skuId));
}

export type AiFeedback = { llmReasons: number; markedWrong: number; rate: number | null };

export function aiFeedback(facts: Fact[]): AiFeedback {
  const llm = facts.filter((f) => f.reasonSource === "llm");
  const wrong = llm.filter((f) => f.reasonMarkedWrong).length;
  return { llmReasons: llm.length, markedWrong: wrong, rate: llm.length ? wrong / llm.length : null };
}

export type Suggestion = {
  id: string;
  area: "Rule" | "Forecast" | "SKU" | "AI";
  title: string;
  detail: string;
  /** What to edit, and where. Never applied automatically. */
  change: string;
};

export type Feedback = {
  /** Distinct plan dates. */
  runs: number;
  decisions: number;
  rules: RuleFeedback[];
  forecast: ForecastCheck;
  skus: SkuPattern[];
  ai: AiFeedback;
  suggestions: Suggestion[];
};

export function buildFeedback(facts: Fact[]): Feedback {
  const rules = ruleFeedback(facts);
  const forecast = forecastCheck(facts);
  const skus = skuPatterns(facts);
  const ai = aiFeedback(facts);
  const suggestions: Suggestion[] = [];
  const rule = (f: Flag) => rules.find((r) => r.flag === f)!;
  const enough = (r: RuleFeedback) => r.decided >= FEEDBACK.minDecisions;
  const drifted = (x: number | null): x is number => x !== null && Math.abs(x - 1) > FEEDBACK.qtyDrift;

  const hd = rule("HIGH_DEMAND");
  if (enough(hd) && drifted(hd.medianQtyRatio) && hd.changed / hd.decided >= 0.3) {
    const next = round2(RULES.highDemandQtyMultiplier * hd.medianQtyRatio);
    suggestions.push({
      id: "high-demand-multiplier",
      area: "Rule",
      title: `High demand orders are ${hd.medianQtyRatio > 1 ? "raised" : "cut"} by about ${pct(Math.abs(hd.medianQtyRatio - 1))}`,
      detail: `Raghav changed ${hd.changed} of ${hd.decided} High demand quantities; the typical new quantity is ${round2(hd.medianQtyRatio)}× the suggestion.`,
      change: `rules-config.ts: highDemandQtyMultiplier ${RULES.highDemandQtyMultiplier} → ${next}`,
    });
  }

  const so = rule("STOCKOUT");
  if (enough(so) && drifted(so.medianQtyRatio) && so.changed / so.decided >= 0.3) {
    suggestions.push({
      id: "stockout-qty",
      area: "Rule",
      title: `Stockout orders are ${so.medianQtyRatio > 1 ? "raised" : "cut"} by about ${pct(Math.abs(so.medianQtyRatio - 1))}`,
      detail: `Stockout orders use each SKU's standard reorder qty from SAP. Raghav changed ${so.changed} of ${so.decided}.`,
      change: `SAP sku_master: Standard_Reorder_Qty ×${round2(so.medianQtyRatio)} for the SKUs he keeps changing (see below)`,
    });
  }

  const os = rule("OVERSTOCK");
  if (enough(os) && os.orderedAnyway / os.decided >= 0.3) {
    suggestions.push({
      id: "overstock-threshold",
      area: "Rule",
      title: "Overstock calls are often ordered anyway",
      detail: `${os.orderedAnyway} of ${os.decided} Overstock results got an order from Raghav, so the line may be too low.`,
      change: `rules-config.ts: overstockAbove ${RULES.standard.overstockAbove} → ${RULES.standard.overstockAbove + 2} weeks (standard), ${RULES.highPerishability.overstockAbove} → ${RULES.highPerishability.overstockAbove + 1} (perishable)`,
    });
  }

  const ok = rule("OK");
  if (enough(ok) && ok.orderedAnyway / ok.decided >= 0.3) {
    suggestions.push({
      id: "stockout-threshold",
      area: "Rule",
      title: "SKUs marked OK still get orders",
      detail: `${ok.orderedAnyway} of ${ok.decided} OK results got an order from Raghav, so stock may run low sooner than the rule thinks.`,
      change: `rules-config.ts: stockoutBelow ${RULES.standard.stockoutBelow} → ${RULES.standard.stockoutBelow + 1} weeks (standard), ${RULES.highPerishability.stockoutBelow} → ${RULES.highPerishability.stockoutBelow + 1} (perishable)`,
    });
  }

  const judged = rule("JUDGMENT").results;
  const share = facts.length ? judged / facts.length : 0;
  if (facts.length >= 10 && share > PILOT.maxJudgmentShare) {
    suggestions.push({
      id: "judgment-share",
      area: "Rule",
      title: `${pct(share)} of SKUs land on Raghav's desk`,
      detail: "Raghav says his rules cover 80–85% of calls. Look at the judgment reasons: missing weeks usually means a data feed gap, not a rule gap.",
      change: "Fix the data gaps first; only then consider lowering minHistoryWeeks in rules-config.ts",
    });
  }

  if (forecast.measured >= FEEDBACK.minMeasured && forecast.bias !== null && Math.abs(forecast.bias) > FEEDBACK.forecastBias) {
    const fest = forecast.festivalBias;
    const festivalDriven = fest !== null && Math.abs(fest) > FEEDBACK.forecastBias;
    suggestions.push({
      id: "forecast-bias",
      area: "Forecast",
      title: `Sales came in ${pct(Math.abs(forecast.bias))} ${forecast.bias > 0 ? "above" : "below"} what the rules expected`,
      detail: `Measured on ${forecast.measured} SKU forecasts.${festivalDriven ? ` In festival months the gap is ${signedPct(fest!)}.` : ""}`,
      change: festivalDriven
        ? `rules-config.ts: festivalUplift ${RULES.festivalUplift} → ${round2(RULES.festivalUplift * (1 + fest!))}`
        : `Check the 4-week window: demand is ${forecast.bias > 0 ? "rising faster" : "falling faster"} than a 4-week average can follow`,
    });
  }

  for (const s of skus) {
    const up = s.medianRatio > 1;
    suggestions.push({
      id: `sku-${s.skuId}`,
      area: "SKU",
      title: `${s.skuId}: ${up ? "raised" : "cut"} in the last ${s.runs} runs`,
      detail: `${s.skuName}. Raghav keeps ordering about ${round2(s.medianRatio)}× the suggestion (last time ${s.lastQty} instead of ${s.suggestedQty}).`,
      change: `SAP sku_master: ${s.skuId} Standard_Reorder_Qty → about ${Math.round(s.suggestedQty * s.medianRatio)} (if its standard qty drives the order)`,
    });
  }

  if (ai.rate !== null && ai.markedWrong > 0) {
    suggestions.push({
      id: "ai-reasons",
      area: "AI",
      title: `${ai.markedWrong} reason${ai.markedWrong === 1 ? "" : "s"} marked wrong (${pct(ai.rate)})`,
      detail: `The limit is ${pct(PILOT.maxReasonWrongRate)}. Above it, switch the LLM off; quantities are not affected.`,
      change: ai.rate > PILOT.maxReasonWrongRate ? "Vercel env: LLM_REASONS=off" : "Nothing yet; keep marking wrong reasons",
    });
  }

  return {
    runs: new Set(facts.map((f) => f.runDate)).size,
    decisions: facts.filter((f) => f.decision).length,
    rules,
    forecast,
    skus,
    ai,
    suggestions,
  };
}
