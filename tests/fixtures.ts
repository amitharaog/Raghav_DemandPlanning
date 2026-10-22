// Builds small in-memory snapshots for tests: no database needed.
import type { Snapshot, SnapshotSku } from "@/lib/snapshot";
import { addDays } from "@/lib/weeks";

export const RUN_DATE = "2026-10-22"; // Thursday; last complete week starts 2026-10-12
export const LAST_WEEK = "2026-10-12";

/** Mondays, oldest first, ending at LAST_WEEK. */
export function weeksEndingAt(last: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(last, -7 * (count - 1 - i)));
}

export function sku(overrides: Partial<SnapshotSku> = {}): SnapshotSku {
  return {
    skuId: "SKU900",
    skuName: "Test SKU",
    category: "Snack",
    perishability: "Low",
    standardReorderQty: 100,
    unitOfMeasure: "Units",
    distributorId: "DIST001",
    distributorName: "NutriFlow Distributors",
    launchDate: null,
    ...overrides,
  };
}

type SkuCase = {
  sku?: Partial<SnapshotSku>;
  /** Weekly sales oldest first, ending at LAST_WEEK. null = week missing from SAP. */
  sales: (number | null)[];
  stock?: number | null;
  onOrder?: number;
};

export function snapshot(cases: SkuCase[], opts: { festival?: boolean; runDate?: string } = {}): Snapshot {
  const runDate = opts.runDate ?? RUN_DATE;
  const maxLen = Math.max(...cases.map((c) => c.sales.length));
  const weeks = weeksEndingAt(LAST_WEEK, maxLen);
  const snap: Snapshot = {
    runDate,
    lastCompleteWeek: LAST_WEEK,
    weeks,
    skus: [],
    sales: {},
    stock: {},
    onOrder: {},
    openPoAsOf: null,
    festival: { isFestivalMonth: opts.festival ?? false, source: "calendar" },
    latestLoad: { id: 1, loadedAt: "2026-10-20T00:00:00.000Z", rejected: [] },
  };
  cases.forEach((c, i) => {
    const s = sku({ skuId: `SKU9${String(i).padStart(2, "0")}`, ...c.sku });
    snap.skus.push(s);
    const ws = weeksEndingAt(LAST_WEEK, c.sales.length);
    snap.sales[s.skuId] = {};
    c.sales.forEach((u, j) => {
      if (u !== null) snap.sales[s.skuId][ws[j]] = u;
    });
    if (c.stock !== null) snap.stock[s.skuId] = { unitsOnHand: c.stock ?? 0, asOfDate: "2026-10-19", locations: ["Pune"] };
    if (c.onOrder) {
      snap.onOrder[s.skuId] = c.onOrder;
      snap.openPoAsOf = "2026-10-19";
    }
  });
  return snap;
}

/** n weeks of the same value. */
export const flat = (value: number, n = 16) => Array<number>(n).fill(value);
