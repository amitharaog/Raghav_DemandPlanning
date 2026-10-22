// Step 3 - Trends: the numbers behind every recommendation, per SKU.
// Pure function of a Snapshot. Nothing here decides anything; rules.ts does.

import { RULES } from "./rules-config";
import type { Snapshot, SnapshotSku } from "./snapshot";
import { addDays, daysBetween, mondayToIsoWeek, parseDate } from "./weeks";

export type Trend = {
  skuId: string;
  /** Weeks from first sale (or launch date) to the last complete week, inclusive. */
  weeksOfHistory: number;
  firstWeek: string | null;
  /** ISO weeks inside the 12-week window (after the SKU's first week) with no SAP row. */
  missingWeeks: string[];
  last12: { week: string; units: number | null }[];
  avg4: number | null;
  avg12: number | null;
  /** avg4 / avg12, e.g. 1.214 = 21.4% above. */
  ratio4to12: number | null;
  stockOnHand: number | null;
  stockAsOf: string | null;
  onOrder: number;
  isFestivalMonth: boolean;
  upliftFactor: number;
  /** Expected weekly demand = avg4 x festival uplift. */
  forecastWeekly: number | null;
  /** (stock + on order) / avg4, before festival uplift. */
  weeksOfStockRaw: number | null;
  /** (stock + on order) / forecastWeekly. This is what the thresholds are checked against. */
  weeksOfStock: number | null;
};

function mondayOf(date: string): string {
  const dow = parseDate(date).getUTCDay() || 7;
  return addDays(date, -(dow - 1));
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function computeTrend(snap: Snapshot, sku: SnapshotSku): Trend {
  const sales = snap.sales[sku.skuId] ?? {};
  const soldWeeks = Object.keys(sales).sort();
  const firstSale = soldWeeks[0] ?? null;
  const start = sku.launchDate ? mondayOf(sku.launchDate) : firstSale;
  const weeksOfHistory = start ? Math.max(0, Math.floor(daysBetween(start, snap.lastCompleteWeek) / 7) + 1) : 0;

  const window = Array.from({ length: RULES.longWindowWeeks }, (_, i) =>
    addDays(snap.lastCompleteWeek, -7 * (RULES.longWindowWeeks - 1 - i)),
  );
  const last12 = window.map((w) => ({ week: w, units: sales[w] ?? null }));
  const missingWeeks = start
    ? last12.filter((w) => w.units === null && w.week >= start).map((w) => mondayToIsoWeek(w.week))
    : [];
  const present = (ws: typeof last12) => ws.filter((w) => w.units !== null).map((w) => w.units as number);
  const avg12 = mean(present(last12));
  const avg4 = mean(present(last12.slice(-RULES.shortWindowWeeks)));

  const st = snap.stock[sku.skuId];
  const onOrder = snap.onOrder[sku.skuId] ?? 0;
  const upliftFactor = snap.festival.isFestivalMonth ? RULES.festivalUplift : 1;
  const forecastWeekly = avg4 === null ? null : avg4 * upliftFactor;
  const supply = st ? st.unitsOnHand + onOrder : null;

  return {
    skuId: sku.skuId,
    weeksOfHistory,
    firstWeek: firstSale,
    missingWeeks,
    last12,
    avg4,
    avg12,
    ratio4to12: avg4 !== null && avg12 ? avg4 / avg12 : null,
    stockOnHand: st?.unitsOnHand ?? null,
    stockAsOf: st?.asOfDate ?? null,
    onOrder,
    isFestivalMonth: snap.festival.isFestivalMonth,
    upliftFactor,
    forecastWeekly,
    weeksOfStockRaw: supply !== null && avg4 ? supply / avg4 : null,
    weeksOfStock: supply !== null && forecastWeekly ? supply / forecastWeekly : null,
  };
}

export function computeTrends(snap: Snapshot): Trend[] {
  return snap.skus.map((s) => computeTrend(snap, s));
}
