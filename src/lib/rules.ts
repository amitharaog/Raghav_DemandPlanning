// Step 4 - Forecast: Raghav's rules, applied in his order.
//
//   e (inputs)  Under 12 weeks of history, or missing data -> Needs Raghav's judgment.
//   a           Festival month: expected demand x 1.25, before any threshold check.
//   b           4-week avg more than 20% above 12-week avg -> High demand, reorder 1.5x standard qty.
//   c           Standard SKUs: < 6 weeks of stock -> Stockout risk (reorder now);
//               > 14 weeks -> Overstock risk (pause next order).
//   d           High-perishability SKUs: < 3 weeks -> Stockout risk; > 4 weeks -> Overstock risk.
//   e (conflict) High demand + Overstock risk say opposite things -> Needs Raghav's judgment.
//
// High demand + Stockout risk agree (both say order), so that is High demand at 1.5x.
// Pure function. The LLM never touches anything in here.

import { RULES } from "./rules-config";
import type { SnapshotSku } from "./snapshot";
import type { Trend } from "./trends";

export const FLAGS = ["HIGH_DEMAND", "STOCKOUT", "OVERSTOCK", "OK", "JUDGMENT"] as const;
export type Flag = (typeof FLAGS)[number];
export type Action = "REORDER" | "PAUSE" | "NO_ACTION" | "REVIEW";

export const FLAG_LABEL: Record<Flag, string> = {
  HIGH_DEMAND: "High demand",
  STOCKOUT: "Stockout risk",
  OVERSTOCK: "Overstock risk",
  OK: "OK",
  JUDGMENT: "Needs Raghav's judgment",
};

export const ACTION_LABEL: Record<Action, string> = {
  REORDER: "Reorder now",
  PAUSE: "Pause next order",
  NO_ACTION: "No action",
  REVIEW: "Raghav to decide",
};

export type Numbers = {
  avg4: number | null;
  avg12: number | null;
  ratio4to12: number | null;
  stockOnHand: number | null;
  onOrder: number;
  isFestivalMonth: boolean;
  upliftFactor: number;
  forecastWeekly: number | null;
  weeksOfStockRaw: number | null;
  weeksOfStock: number | null;
  stockoutBelow: number;
  overstockAbove: number;
  standardReorderQty: number;
  weeksOfHistory: number;
  missingWeeks: string[];
  /** Weeks of stock after the suggested order lands (null when no order). */
  coverAfterOrder: number | null;
};

export type Recommendation = {
  skuId: string;
  flag: Flag;
  action: Action;
  /** null = no rule result; Raghav sets the qty. */
  suggestedQty: number | null;
  /** Short statement of the rule that decided the outcome. */
  ruleFired: string;
  /** Every rule step, in order, for the audit trail. */
  ruleTrace: string[];
  /** Flags that also fired but did not decide the outcome (e.g. Stockout under High demand). */
  alsoFlagged: Flag[];
  judgmentReasons: string[];
  numbers: Numbers;
};

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const pct = (ratio: number) => `${((ratio - 1) * 100).toFixed(1)}%`;
const signedPct = (ratio: number) => `${ratio >= 1 ? "+" : ""}${pct(ratio)}`;

export function limitsFor(sku: Pick<SnapshotSku, "perishability">) {
  return sku.perishability === "High" ? RULES.highPerishability : RULES.standard;
}

export function applyRules(sku: SnapshotSku, t: Trend): Recommendation {
  const limits = limitsFor(sku);
  const limitRule = sku.perishability === "High" ? "d" : "c";
  const trace: string[] = [];
  const judgment: string[] = [];

  // e (inputs): can the rules be trusted for this SKU at all?
  if (t.weeksOfHistory < RULES.minHistoryWeeks) {
    judgment.push(`only ${t.weeksOfHistory} week(s) of sales history (rules need ${RULES.minHistoryWeeks})`);
  }
  if (t.missingWeeks.length) {
    judgment.push(`missing sales data for ${t.missingWeeks.join(", ")}`);
  }
  if (t.stockOnHand === null) judgment.push("no stock figure in the SAP export");
  if (t.avg4 === null || t.avg12 === null) judgment.push("no sales in the 12-week window");
  else if (t.forecastWeekly === 0) judgment.push("zero sales in the last 4 weeks, so weeks of stock cannot be calculated");
  if (judgment.length) trace.push(`e. Needs judgment: ${judgment.join("; ")}`);

  // a. Festival uplift, before any threshold check.
  trace.push(
    t.isFestivalMonth
      ? `a. Festival month: expected demand = 4-wk avg x ${RULES.festivalUplift}`
      : "a. Not a festival month: expected demand = 4-wk avg",
  );

  // b. High demand.
  const highDemand = t.ratio4to12 !== null && t.avg4 !== null && t.avg12 !== null && t.avg4 > RULES.highDemandRatio * t.avg12;
  if (t.ratio4to12 !== null) {
    trace.push(
      `b. 4-wk avg ${f1(t.avg4!)} vs 12-wk avg ${f1(t.avg12!)} = ${signedPct(t.ratio4to12)} ` +
        `(High demand above +${pct(RULES.highDemandRatio)}) -> ${highDemand ? "High demand" : "not high demand"}`,
    );
  }

  // c / d. Weeks of stock thresholds.
  const wos = t.weeksOfStock;
  const stockout = wos !== null && wos < limits.stockoutBelow;
  const overstock = wos !== null && wos > limits.overstockAbove;
  if (wos !== null) {
    trace.push(
      `${limitRule}. ${f2(wos)} weeks of stock vs ${limits.stockoutBelow}-${limits.overstockAbove} week range` +
        `${sku.perishability === "High" ? " (high-perishability limits)" : ""} -> ` +
        `${stockout ? "Stockout risk" : overstock ? "Overstock risk" : "within range"}`,
    );
  }

  // e (conflict).
  if (!judgment.length && highDemand && overstock) {
    judgment.push(
      `flags conflict: High demand (sales up ${pct(t.ratio4to12!)}) but Overstock risk (${f2(wos!)} weeks of stock)`,
    );
    trace.push(`e. Needs judgment: ${judgment[judgment.length - 1]}`);
  }

  const alsoFlagged: Flag[] = [];
  let flag: Flag;
  let action: Action;
  let qty: number | null;
  let ruleFired: string;

  if (judgment.length) {
    flag = "JUDGMENT";
    action = "REVIEW";
    qty = null;
    ruleFired = `e. Needs judgment: ${judgment.join("; ")}`;
    if (highDemand) alsoFlagged.push("HIGH_DEMAND");
    if (stockout) alsoFlagged.push("STOCKOUT");
    if (overstock) alsoFlagged.push("OVERSTOCK");
  } else if (highDemand) {
    flag = "HIGH_DEMAND";
    action = "REORDER";
    qty = Math.ceil(sku.standardReorderQty * RULES.highDemandQtyMultiplier);
    ruleFired = `b. High demand: 4-wk avg ${pct(t.ratio4to12!)} above 12-wk avg -> ${RULES.highDemandQtyMultiplier}x standard qty`;
    if (stockout) {
      alsoFlagged.push("STOCKOUT");
      ruleFired += `; ${limitRule}. Stockout risk agrees (${f2(wos!)} weeks < ${limits.stockoutBelow})`;
    }
  } else if (stockout) {
    flag = "STOCKOUT";
    action = "REORDER";
    qty = sku.standardReorderQty;
    ruleFired = `${limitRule}. Stockout risk: ${f2(wos!)} weeks of stock < ${limits.stockoutBelow}`;
  } else if (overstock) {
    flag = "OVERSTOCK";
    action = "PAUSE";
    qty = 0;
    ruleFired = `${limitRule}. Overstock risk: ${f2(wos!)} weeks of stock > ${limits.overstockAbove}`;
  } else {
    flag = "OK";
    action = "NO_ACTION";
    qty = 0;
    ruleFired = `No rule fired: ${f2(wos!)} weeks of stock within ${limits.stockoutBelow}-${limits.overstockAbove}, sales not up more than 20%`;
  }

  const supply = t.stockOnHand === null ? null : t.stockOnHand + t.onOrder;
  return {
    skuId: sku.skuId,
    flag,
    action,
    suggestedQty: qty,
    ruleFired,
    ruleTrace: trace,
    alsoFlagged,
    judgmentReasons: judgment,
    numbers: {
      avg4: t.avg4,
      avg12: t.avg12,
      ratio4to12: t.ratio4to12,
      stockOnHand: t.stockOnHand,
      onOrder: t.onOrder,
      isFestivalMonth: t.isFestivalMonth,
      upliftFactor: t.upliftFactor,
      forecastWeekly: t.forecastWeekly,
      weeksOfStockRaw: t.weeksOfStockRaw,
      weeksOfStock: wos,
      stockoutBelow: limits.stockoutBelow,
      overstockAbove: limits.overstockAbove,
      standardReorderQty: sku.standardReorderQty,
      weeksOfHistory: t.weeksOfHistory,
      missingWeeks: t.missingWeeks,
      coverAfterOrder: qty && supply !== null && t.forecastWeekly ? (supply + qty) / t.forecastWeekly : null,
    },
  };
}
