// Parses and validates the SAP export files. Pure functions: no database.
// Each parser returns the good rows plus a list of rejected rows with reasons,
// so one bad line never silently disappears and never blocks the rest.

import { parse } from "csv-parse/sync";
import { isoWeekToMonday, parseDate } from "./weeks";

export const SAP_FILES = {
  distributors: "distributor_master.csv",
  skus: "sku_master.csv",
  sales: "weekly_sales.csv",
  inventory: "current_inventory.csv",
  calendar: "calendar.csv",
  openPos: "open_purchase_orders.csv",
} as const;

export type Rejected = { file: string; line?: number; reason: string };
export type Parsed<T> = { rows: T[]; rejected: Rejected[] };

export type Distributor = { distributorId: string; distributorName: string; region: string; status: string };
export type Sku = {
  skuId: string;
  skuName: string;
  category: string;
  perishability: "Low" | "High";
  standardReorderQty: number;
  unitOfMeasure: string;
  distributorId: string;
  launchDate: string | null;
};
export type WeeklySale = { skuId: string; isoWeek: string; weekStart: string; unitsSold: number };
export type InventoryRow = { skuId: string; location: string; unitsOnHand: number; asOfDate: string };
export type CalendarRow = { yearMonth: string; isFestivalMonth: boolean };
export type OpenPo = { poNumber: string; skuId: string; qtyOnOrder: number; expectedDate: string | null; asOfDate: string };

type Raw = Record<string, string>;

function readCsv(file: string, text: string, required: string[]): Raw[] {
  const records: Raw[] = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  const header = records.length ? Object.keys(records[0]) : firstLineHeaders(text);
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) {
    // A wrong header means the export format changed: stop, don't guess.
    throw new Error(`${file}: missing column(s) ${missing.join(", ")}. Found: ${header.join(", ")}`);
  }
  return records;
}

function firstLineHeaders(text: string): string[] {
  return (text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "").split(",").map((h) => h.trim());
}

function toInt(value: string | undefined, field: string): number {
  if (value === undefined || value === "") throw new Error(`${field} is blank`);
  if (!/^-?\d+$/.test(value)) throw new Error(`${field} "${value}" is not a whole number`);
  const n = Number(value);
  if (n < 0) throw new Error(`${field} ${n} is negative`);
  return n;
}

function required(value: string | undefined, field: string): string {
  if (value === undefined || value === "") throw new Error(`${field} is blank`);
  return value;
}

function parseRows<T>(file: string, records: Raw[], key: (r: T) => string, map: (r: Raw) => T): Parsed<T> {
  const rows: T[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  records.forEach((raw, i) => {
    const line = i + 2; // header is line 1
    try {
      const row = map(raw);
      const k = key(row);
      if (seen.has(k)) throw new Error(`duplicate of an earlier row (${k})`);
      seen.add(k);
      rows.push(row);
    } catch (err) {
      rejected.push({ file, line, reason: (err as Error).message });
    }
  });
  return { rows, rejected };
}

export function parseDistributors(text: string): Parsed<Distributor> {
  const file = SAP_FILES.distributors;
  const records = readCsv(file, text, ["Distributor_ID", "Distributor_Name", "Region", "Status"]);
  return parseRows(file, records, (r) => r.distributorId, (r) => ({
    distributorId: required(r.Distributor_ID, "Distributor_ID"),
    distributorName: required(r.Distributor_Name, "Distributor_Name"),
    region: required(r.Region, "Region"),
    status: required(r.Status, "Status"),
  }));
}

export function parseSkus(text: string): Parsed<Sku> {
  const file = SAP_FILES.skus;
  const records = readCsv(file, text, [
    "SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID",
  ]);
  return parseRows(file, records, (r) => r.skuId, (r) => {
    const perishability = required(r.Perishability, "Perishability");
    if (perishability !== "Low" && perishability !== "High") {
      throw new Error(`Perishability "${perishability}" must be Low or High`);
    }
    const qty = toInt(r.Standard_Reorder_Qty, "Standard_Reorder_Qty");
    if (qty === 0) throw new Error("Standard_Reorder_Qty is 0");
    // Launch_Date is optional: SAP does not export it today.
    const launch = r.Launch_Date ? (parseDate(r.Launch_Date), r.Launch_Date) : null;
    return {
      skuId: required(r.SKU_ID, "SKU_ID"),
      skuName: required(r.SKU_Name, "SKU_Name"),
      category: required(r.Category, "Category"),
      perishability,
      standardReorderQty: qty,
      unitOfMeasure: required(r.Unit_of_Measure, "Unit_of_Measure"),
      distributorId: required(r.Distributor_ID, "Distributor_ID"),
      launchDate: launch,
    };
  });
}

export function parseWeeklySales(text: string): Parsed<WeeklySale> {
  const file = SAP_FILES.sales;
  const records = readCsv(file, text, ["SKU_ID", "Week", "Units_Sold"]);
  return parseRows(file, records, (r) => `${r.skuId} ${r.isoWeek}`, (r) => {
    const isoWeek = required(r.Week, "Week");
    return {
      skuId: required(r.SKU_ID, "SKU_ID"),
      isoWeek,
      weekStart: isoWeekToMonday(isoWeek),
      unitsSold: toInt(r.Units_Sold, "Units_Sold"),
    };
  });
}

export function parseInventory(text: string): Parsed<InventoryRow> {
  const file = SAP_FILES.inventory;
  const records = readCsv(file, text, ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"]);
  return parseRows(file, records, (r) => `${r.skuId} ${r.location} ${r.asOfDate}`, (r) => {
    const asOfDate = required(r.As_Of_Date, "As_Of_Date");
    parseDate(asOfDate);
    return {
      skuId: required(r.SKU_ID, "SKU_ID"),
      location: required(r.Location, "Location"),
      unitsOnHand: toInt(r.Units_On_Hand, "Units_On_Hand"),
      asOfDate,
    };
  });
}

export function parseCalendar(text: string): Parsed<CalendarRow> {
  const file = SAP_FILES.calendar;
  const records = readCsv(file, text, ["Year_Month", "Is_Festival_Month"]);
  return parseRows(file, records, (r) => r.yearMonth, (r) => {
    const yearMonth = required(r.Year_Month, "Year_Month");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) throw new Error(`Year_Month "${yearMonth}" is not YYYY-MM`);
    const flag = required(r.Is_Festival_Month, "Is_Festival_Month").toUpperCase();
    if (flag !== "TRUE" && flag !== "FALSE") throw new Error(`Is_Festival_Month "${flag}" must be TRUE or FALSE`);
    return { yearMonth, isFestivalMonth: flag === "TRUE" };
  });
}

export function parseOpenPos(text: string): Parsed<OpenPo> {
  const file = SAP_FILES.openPos;
  const records = readCsv(file, text, ["PO_Number", "SKU_ID", "Qty_On_Order", "As_Of_Date"]);
  return parseRows(file, records, (r) => `${r.poNumber} ${r.skuId} ${r.asOfDate}`, (r) => {
    const asOfDate = required(r.As_Of_Date, "As_Of_Date");
    parseDate(asOfDate);
    const expected = r.Expected_Date ? r.Expected_Date : null;
    if (expected) parseDate(expected);
    return {
      poNumber: required(r.PO_Number, "PO_Number"),
      skuId: required(r.SKU_ID, "SKU_ID"),
      qtyOnOrder: toInt(r.Qty_On_Order, "Qty_On_Order"),
      expectedDate: expected,
      asOfDate,
    };
  });
}

/** Drops rows whose foreign key is unknown and reports them. */
export function keepKnown<T>(
  parsed: Parsed<T>,
  file: string,
  known: Set<string>,
  keyOf: (r: T) => string,
  label: string,
): Parsed<T> {
  const rows: T[] = [];
  const rejected = [...parsed.rejected];
  for (const row of parsed.rows) {
    if (known.has(keyOf(row))) rows.push(row);
    else rejected.push({ file, reason: `${label} ${keyOf(row)} is not in the master` });
  }
  return { rows, rejected };
}
