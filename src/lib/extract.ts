// Step 2 - Extract to Excel: one clean workbook per run with exactly the data the
// forecast uses, so Raghav (or an auditor) can check any number by hand.

import ExcelJS from "exceljs";
import type { Snapshot } from "./snapshot";
import { mondayToIsoWeek } from "./weeks";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };

function addTable(ws: ExcelJS.Worksheet, headers: string[], rows: (string | number | null)[][], widths?: number[]) {
  ws.addRow(headers);
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((c) => (c.fill = HEADER_FILL));
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  for (const r of rows) ws.addRow(r);
  headers.forEach((h, i) => (ws.getColumn(i + 1).width = widths?.[i] ?? Math.max(10, h.length + 2)));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

export type ExtractNotes = string[];

export async function buildExtract(snap: Snapshot, notes: ExtractNotes = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Freshroots demand planning";
  wb.created = new Date();

  const info = wb.addWorksheet("Run info");
  const infoRows: [string, string][] = [
    ["Run date", snap.runDate],
    ["Last complete sales week", `${mondayToIsoWeek(snap.lastCompleteWeek)} (week starting ${snap.lastCompleteWeek})`],
    ["Weeks of sales in export", String(snap.weeks.length)],
    ["SKUs", String(snap.skus.length)],
    ["Festival month", `${snap.festival.isFestivalMonth ? "Yes" : "No"} (${snap.festival.source})`],
    ["Open purchase orders", snap.openPoAsOf ? `as of ${snap.openPoAsOf}` : "NOT LOADED - stock on order counted as 0"],
    ["SAP load batch", snap.latestLoad ? `#${snap.latestLoad.id} at ${snap.latestLoad.loadedAt}` : "none"],
    ...notes.map((n, i) => [i === 0 ? "Notes" : "", n] as [string, string]),
  ];
  for (const r of infoRows) info.addRow(r);
  info.getColumn(1).width = 28;
  info.getColumn(2).width = 80;
  info.getColumn(1).font = { bold: true };

  // Sales by SKU by week: one row per SKU, one column per week. Blank = no row in SAP.
  const sales = wb.addWorksheet("Sales by week");
  addTable(
    sales,
    ["SKU_ID", "SKU_Name", ...snap.weeks.map(mondayToIsoWeek)],
    snap.skus.map((s) => [s.skuId, s.skuName, ...snap.weeks.map((w) => snap.sales[s.skuId]?.[w] ?? null)]),
    [10, 40, ...snap.weeks.map(() => 10)],
  );

  const stock = wb.addWorksheet("Current stock");
  addTable(
    stock,
    ["SKU_ID", "SKU_Name", "Units_On_Hand", "As_Of_Date", "Locations", "Units_On_Order", "Stock_In_Hand_Plus_On_Order"],
    snap.skus.map((s) => {
      const st = snap.stock[s.skuId];
      const onOrder = snap.onOrder[s.skuId] ?? 0;
      return [
        s.skuId,
        s.skuName,
        st?.unitsOnHand ?? null,
        st?.asOfDate ?? "MISSING",
        st?.locations.join(", ") ?? "",
        onOrder,
        st ? st.unitsOnHand + onOrder : null,
      ];
    }),
    [10, 40, 14, 12, 26, 15, 28],
  );

  const pos = wb.addWorksheet("Open POs");
  if (snap.openPoAsOf) {
    addTable(
      pos,
      ["SKU_ID", "SKU_Name", "Units_On_Order", "As_Of_Date"],
      snap.skus.filter((s) => snap.onOrder[s.skuId]).map((s) => [s.skuId, s.skuName, snap.onOrder[s.skuId], snap.openPoAsOf]),
      [10, 40, 15, 12],
    );
  } else {
    pos.addRow(["No open purchase order file has been loaded. Stock on order is counted as 0 for every SKU."]);
    pos.getColumn(1).width = 100;
  }

  const attrs = wb.addWorksheet("SKU attributes");
  addTable(
    attrs,
    [
      "SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure",
      "Distributor_ID", "Distributor_Name", "Launch_Date", "Launch_Date_Source",
    ],
    snap.skus.map((s) => {
      const first = snap.weeks.find((w) => snap.sales[s.skuId]?.[w] !== undefined) ?? null;
      return [
        s.skuId, s.skuName, s.category, s.perishability, s.standardReorderQty, s.unitOfMeasure,
        s.distributorId, s.distributorName,
        s.launchDate ?? first,
        s.launchDate ? "SKU master" : first ? "First week in SAP export (not a true launch date)" : "No sales",
      ];
    }),
    [10, 40, 12, 13, 20, 15, 14, 26, 12, 46],
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
