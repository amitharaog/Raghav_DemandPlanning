// Reads everything one run needs from the database into a plain object, as of a
// run date. Everything downstream (extract, trends, rules, checks) works on this
// object only, so it can be unit-tested without a database.

import { getPool } from "./db";
import type { Rejected } from "./sapFiles";
import { addDays, parseDate } from "./weeks";

export type SnapshotSku = {
  skuId: string;
  skuName: string;
  category: string;
  perishability: "Low" | "High";
  standardReorderQty: number;
  unitOfMeasure: string;
  distributorId: string;
  distributorName: string;
  launchDate: string | null;
};

export type Snapshot = {
  runDate: string;
  /** Monday of the last full week (Mon-Sun) before the run date. */
  lastCompleteWeek: string;
  /** Every week in the export up to lastCompleteWeek, ascending (Mondays). */
  weeks: string[];
  skus: SnapshotSku[];
  /** skuId -> weekStart -> units sold. A missing key means SAP sent no row for that week. */
  sales: Record<string, Record<string, number>>;
  /** skuId -> latest stock on or before the run date, summed across locations. */
  stock: Record<string, { unitsOnHand: number; asOfDate: string; locations: string[] }>;
  /** skuId -> units on order from the latest open-PO file on or before the run date. */
  onOrder: Record<string, number>;
  openPoAsOf: string | null;
  festival: { isFestivalMonth: boolean; source: "calendar" | "default-oct-nov-mar" };
  latestLoad: { id: number; loadedAt: string; rejected: Rejected[] } | null;
};

/** Monday of the last complete Mon-Sun week strictly before the run date. */
export function lastCompleteWeekStart(runDate: string): string {
  const dow = parseDate(runDate).getUTCDay() || 7; // Mon=1 .. Sun=7
  const thisMonday = addDays(runDate, -(dow - 1));
  return addDays(thisMonday, -7);
}

export const DEFAULT_FESTIVAL_MONTHS = [3, 10, 11];

export async function readSnapshot(runDate: string): Promise<Snapshot> {
  const db = getPool();
  const lastCompleteWeek = lastCompleteWeekStart(runDate);

  const skus = (
    await db.query(
      `select s.sku_id, s.sku_name, s.category, s.perishability, s.standard_reorder_qty, s.unit_of_measure,
              s.distributor_id, d.distributor_name, s.launch_date
         from skus s join distributors d using (distributor_id)
        order by s.sku_id`,
    )
  ).rows.map((r) => ({
    skuId: r.sku_id,
    skuName: r.sku_name,
    category: r.category,
    perishability: r.perishability,
    standardReorderQty: r.standard_reorder_qty,
    unitOfMeasure: r.unit_of_measure,
    distributorId: r.distributor_id,
    distributorName: r.distributor_name,
    launchDate: r.launch_date,
  })) as SnapshotSku[];

  const sales: Snapshot["sales"] = {};
  const weekSet = new Set<string>();
  const salesRows = await db.query(
    `select sku_id, week_start, units_sold from weekly_sales where week_start <= $1 order by week_start`,
    [lastCompleteWeek],
  );
  for (const r of salesRows.rows) {
    (sales[r.sku_id] ??= {})[r.week_start] = r.units_sold;
    weekSet.add(r.week_start);
  }

  const stock: Snapshot["stock"] = {};
  const stockRows = await db.query(
    `select i.sku_id, i.location, i.units_on_hand, i.as_of_date
       from inventory_snapshots i
       join (select sku_id, max(as_of_date) as as_of_date from inventory_snapshots
              where as_of_date <= $1 group by sku_id) latest using (sku_id, as_of_date)`,
    [runDate],
  );
  for (const r of stockRows.rows) {
    const s = (stock[r.sku_id] ??= { unitsOnHand: 0, asOfDate: r.as_of_date, locations: [] });
    s.unitsOnHand += r.units_on_hand;
    s.locations.push(r.location);
  }

  const onOrder: Snapshot["onOrder"] = {};
  const poAsOf = (
    await db.query(`select max(as_of_date) as d from open_purchase_orders where as_of_date <= $1`, [runDate])
  ).rows[0]?.d as string | null;
  if (poAsOf) {
    const poRows = await db.query(
      `select sku_id, sum(qty_on_order)::int as qty from open_purchase_orders where as_of_date = $1 group by sku_id`,
      [poAsOf],
    );
    for (const r of poRows.rows) onOrder[r.sku_id] = r.qty;
  }

  const yearMonth = runDate.slice(0, 7);
  const cal = (await db.query(`select is_festival_month from festival_calendar where year_month = $1`, [yearMonth]))
    .rows[0];
  const festival: Snapshot["festival"] = cal
    ? { isFestivalMonth: cal.is_festival_month, source: "calendar" }
    : { isFestivalMonth: DEFAULT_FESTIVAL_MONTHS.includes(Number(runDate.slice(5, 7))), source: "default-oct-nov-mar" };

  const load = (await db.query(`select id, loaded_at, rejected from load_batches order by id desc limit 1`)).rows[0];

  return {
    runDate,
    lastCompleteWeek,
    weeks: [...weekSet].sort(),
    skus,
    sales,
    stock,
    onOrder,
    openPoAsOf: poAsOf ?? null,
    festival,
    latestLoad: load ? { id: load.id, loadedAt: new Date(load.loaded_at).toISOString(), rejected: load.rejected } : null,
  };
}
