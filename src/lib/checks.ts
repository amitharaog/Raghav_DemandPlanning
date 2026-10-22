// Data kill switch. Runs before any rule. A "halt" stops the run: no
// recommendations are published, so Raghav never reviews numbers built on bad data.
// A "warning" is shown on every page of the run but does not stop it.

import { RULES } from "./rules-config";
import type { Snapshot } from "./snapshot";
import { addDays, daysBetween, mondayToIsoWeek } from "./weeks";

export const DATA_LIMITS = {
  /** Stock snapshot older than this (days before the run date) halts the run. */
  maxStockAgeDays: 3,
  /** More than this share of SKUs with no sales in the 12-week window or no stock halts the run. */
  maxMissingSkuShare: 0.05,
  /** Sales rows in the 12-week window falling by more than this vs the last run halts the run. */
  maxSalesRowDrop: 0.2,
} as const;

export type DataCheck = { halts: string[]; warnings: string[]; salesRowsInWindow: number };

export function dataChecks(snap: Snapshot, previous: { salesRowsInWindow: number } | null): DataCheck {
  const halts: string[] = [];
  const warnings: string[] = [];
  const windowStart = addDays(snap.lastCompleteWeek, -7 * (RULES.longWindowWeeks - 1));
  const salesRowsInWindow = Object.values(snap.sales).reduce(
    (n, weeks) => n + Object.keys(weeks).filter((w) => w >= windowStart).length,
    0,
  );

  if (snap.skus.length === 0) halts.push("No SKUs in the database. Load the SAP export first.");

  const latestWeek = snap.weeks[snap.weeks.length - 1];
  if (!latestWeek) halts.push("No sales data up to the run date.");
  else if (latestWeek !== snap.lastCompleteWeek) {
    halts.push(
      `Sales data is stale: the latest week in the SAP export is ${mondayToIsoWeek(latestWeek)}, ` +
        `but the last complete week before ${snap.runDate} is ${mondayToIsoWeek(snap.lastCompleteWeek)}.`,
    );
  }

  const stockDates = Object.values(snap.stock).map((s) => s.asOfDate).sort();
  const latestStock = stockDates[stockDates.length - 1];
  if (!latestStock) halts.push("No stock snapshot on or before the run date.");
  else {
    const age = daysBetween(latestStock, snap.runDate);
    if (age > DATA_LIMITS.maxStockAgeDays) {
      halts.push(`Stock snapshot is ${age} days old (as of ${latestStock}); the limit is ${DATA_LIMITS.maxStockAgeDays} days.`);
    }
    const older = Object.entries(snap.stock).filter(([, s]) => s.asOfDate !== latestStock).map(([id]) => id);
    if (older.length) warnings.push(`Stock for ${older.join(", ")} is older than ${latestStock}.`);
  }

  if (snap.skus.length) {
    const missing = snap.skus
      .filter((s) => !snap.stock[s.skuId] || !Object.keys(snap.sales[s.skuId] ?? {}).some((w) => w >= windowStart))
      .map((s) => s.skuId);
    const share = missing.length / snap.skus.length;
    if (share > DATA_LIMITS.maxMissingSkuShare) {
      halts.push(
        `${missing.length} of ${snap.skus.length} SKUs (${(share * 100).toFixed(0)}%) have no recent sales or no stock ` +
          `(limit ${DATA_LIMITS.maxMissingSkuShare * 100}%): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""}.`,
      );
    } else if (missing.length) {
      warnings.push(`${missing.join(", ")} have no recent sales or no stock and go to Raghav.`);
    }
  }

  if (previous && previous.salesRowsInWindow > 0) {
    const drop = 1 - salesRowsInWindow / previous.salesRowsInWindow;
    if (drop > DATA_LIMITS.maxSalesRowDrop) {
      halts.push(
        `Sales rows in the 12-week window fell ${(drop * 100).toFixed(0)}% since the last run ` +
          `(${previous.salesRowsInWindow} -> ${salesRowsInWindow}); the SAP export may be incomplete.`,
      );
    }
  }

  const rejected = snap.latestLoad?.rejected ?? [];
  const unlinked = rejected.filter((r) => /not in the master/.test(r.reason));
  if (unlinked.length) {
    halts.push(
      `The last SAP load had ${unlinked.length} row(s) whose SKU or distributor ID is not in the master ` +
        `(e.g. ${unlinked[0].file}: ${unlinked[0].reason}). Fix the master data and reload.`,
    );
  }
  const otherRejects = rejected.length - unlinked.length;
  if (otherRejects > 0) warnings.push(`The last SAP load rejected ${otherRejects} malformed row(s); see the load log.`);

  if (!snap.openPoAsOf) {
    warnings.push("No open purchase orders loaded: stock on order is counted as 0, so weeks of stock may be understated.");
  }
  if (snap.festival.source !== "calendar") {
    warnings.push(`${snap.runDate.slice(0, 7)} is not in the festival calendar; used the default Oct/Nov/Mar rule.`);
  }

  return { halts, warnings, salesRowsInWindow };
}
