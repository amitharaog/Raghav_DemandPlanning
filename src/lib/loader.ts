// Step 1 - SAP (input): reads an SAP export folder into the database.
// Masters load first so sales/stock rows can be checked against them.
// Everything happens in one transaction: a load either lands fully or not at all.

import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { withTransaction } from "./db";
import {
  SAP_FILES,
  keepKnown,
  parseCalendar,
  parseDistributors,
  parseInventory,
  parseOpenPos,
  parseSkus,
  parseWeeklySales,
  type Rejected,
} from "./sapFiles";

export type LoadResult = {
  batchId: number;
  sourceDir: string;
  rowCounts: Record<string, number>;
  rejected: Rejected[];
  missingFiles: string[];
};

function readIfPresent(dir: string, file: string): string | null {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

async function knownIds(client: pg.PoolClient, sql: string): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>(sql);
  return new Set(rows.map((r) => r.id));
}

export async function loadSapExport(dir: string): Promise<LoadResult> {
  if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
  const rowCounts: Record<string, number> = {};
  const rejected: Rejected[] = [];
  const missingFiles: string[] = [];

  return withTransaction(async (client) => {
    const distText = readIfPresent(dir, SAP_FILES.distributors);
    if (distText) {
      const d = parseDistributors(distText);
      rejected.push(...d.rejected);
      for (const r of d.rows) {
        await client.query(
          `insert into distributors (distributor_id, distributor_name, region, status) values ($1,$2,$3,$4)
           on conflict (distributor_id) do update set distributor_name = excluded.distributor_name,
             region = excluded.region, status = excluded.status`,
          [r.distributorId, r.distributorName, r.region, r.status],
        );
      }
      rowCounts.distributors = d.rows.length;
    } else missingFiles.push(SAP_FILES.distributors);

    const skuText = readIfPresent(dir, SAP_FILES.skus);
    if (skuText) {
      const dists = await knownIds(client, "select distributor_id as id from distributors");
      const s = keepKnown(parseSkus(skuText), SAP_FILES.skus, dists, (r) => r.distributorId, "Distributor_ID");
      rejected.push(...s.rejected);
      for (const r of s.rows) {
        await client.query(
          `insert into skus (sku_id, sku_name, category, perishability, standard_reorder_qty, unit_of_measure,
             distributor_id, launch_date) values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (sku_id) do update set sku_name = excluded.sku_name, category = excluded.category,
             perishability = excluded.perishability, standard_reorder_qty = excluded.standard_reorder_qty,
             unit_of_measure = excluded.unit_of_measure, distributor_id = excluded.distributor_id,
             launch_date = coalesce(excluded.launch_date, skus.launch_date)`,
          [r.skuId, r.skuName, r.category, r.perishability, r.standardReorderQty, r.unitOfMeasure, r.distributorId, r.launchDate],
        );
      }
      rowCounts.skus = s.rows.length;
    } else missingFiles.push(SAP_FILES.skus);

    const skus = await knownIds(client, "select sku_id as id from skus");

    const salesText = readIfPresent(dir, SAP_FILES.sales);
    if (salesText) {
      const s = keepKnown(parseWeeklySales(salesText), SAP_FILES.sales, skus, (r) => r.skuId, "SKU_ID");
      rejected.push(...s.rejected);
      for (const r of s.rows) {
        await client.query(
          `insert into weekly_sales (sku_id, iso_week, week_start, units_sold) values ($1,$2,$3,$4)
           on conflict (sku_id, week_start) do update set units_sold = excluded.units_sold, iso_week = excluded.iso_week`,
          [r.skuId, r.isoWeek, r.weekStart, r.unitsSold],
        );
      }
      rowCounts.weekly_sales = s.rows.length;
    } else missingFiles.push(SAP_FILES.sales);

    const invText = readIfPresent(dir, SAP_FILES.inventory);
    if (invText) {
      const s = keepKnown(parseInventory(invText), SAP_FILES.inventory, skus, (r) => r.skuId, "SKU_ID");
      rejected.push(...s.rejected);
      for (const r of s.rows) {
        await client.query(
          `insert into inventory_snapshots (sku_id, location, as_of_date, units_on_hand) values ($1,$2,$3,$4)
           on conflict (sku_id, location, as_of_date) do update set units_on_hand = excluded.units_on_hand`,
          [r.skuId, r.location, r.asOfDate, r.unitsOnHand],
        );
      }
      rowCounts.inventory = s.rows.length;
    } else missingFiles.push(SAP_FILES.inventory);

    const calText = readIfPresent(dir, SAP_FILES.calendar);
    if (calText) {
      const c = parseCalendar(calText);
      rejected.push(...c.rejected);
      for (const r of c.rows) {
        await client.query(
          `insert into festival_calendar (year_month, is_festival_month) values ($1,$2)
           on conflict (year_month) do update set is_festival_month = excluded.is_festival_month`,
          [r.yearMonth, r.isFestivalMonth],
        );
      }
      rowCounts.calendar = c.rows.length;
    } else missingFiles.push(SAP_FILES.calendar);

    const poText = readIfPresent(dir, SAP_FILES.openPos);
    if (poText) {
      const p = keepKnown(parseOpenPos(poText), SAP_FILES.openPos, skus, (r) => r.skuId, "SKU_ID");
      rejected.push(...p.rejected);
      for (const r of p.rows) {
        await client.query(
          `insert into open_purchase_orders (po_number, sku_id, qty_on_order, expected_date, as_of_date)
           values ($1,$2,$3,$4,$5)
           on conflict (po_number, sku_id, as_of_date) do update set qty_on_order = excluded.qty_on_order,
             expected_date = excluded.expected_date`,
          [r.poNumber, r.skuId, r.qtyOnOrder, r.expectedDate, r.asOfDate],
        );
      }
      rowCounts.open_purchase_orders = p.rows.length;
    } else missingFiles.push(SAP_FILES.openPos);

    const { rows } = await client.query<{ id: number }>(
      `insert into load_batches (source_dir, row_counts, rejected) values ($1, $2, $3) returning id`,
      [dir, JSON.stringify(rowCounts), JSON.stringify(rejected)],
    );
    return { batchId: rows[0].id, sourceDir: dir, rowCounts, rejected, missingFiles };
  });
}
