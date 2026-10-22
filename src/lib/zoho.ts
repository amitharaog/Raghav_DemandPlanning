// Step 6 - Zoho: purchase orders for approved items only.
//
// There is no live Zoho connection in the pilot. `submitPurchaseOrders` is the one
// place that "sends" POs; today it writes a CSV in Zoho Inventory's purchase order
// import layout. To go live, replace its body with Zoho Inventory API calls
// (POST /inventory/v1/purchaseorders, one call per PO, created as Draft) and keep
// the signature. Nothing else in the app needs to change.

import { getPool } from "./db";

export type ApprovedLine = {
  skuId: string;
  skuName: string;
  unitOfMeasure: string;
  distributorId: string;
  distributorName: string;
  quantity: number;
  decision: "APPROVE" | "CHANGE_QTY";
  decisionReason: string | null;
};

export type PurchaseOrderLine = {
  poDate: string;
  poNumber: string;
  vendorName: string;
  referenceNumber: string;
  itemName: string;
  sku: string;
  quantity: number;
  usageUnit: string;
  notes: string;
};

/**
 * Column headers for Zoho Inventory's "Import Purchase Orders" screen. Zoho maps
 * columns by name during import; check these against the sample file in your
 * Zoho org (Purchases > Purchase Orders > Import) before the first live import.
 * Rate is left blank so Zoho uses the item's purchase rate.
 */
export const ZOHO_PO_COLUMNS = [
  "Purchase Order Date",
  "Purchase Order Number",
  "Vendor Name",
  "Reference#",
  "Item Name",
  "SKU",
  "Quantity",
  "Rate",
  "Usage unit",
  "Status",
  "Notes",
] as const;

/** One PO per vendor per run; one line per SKU. */
export function buildPurchaseOrderLines(runId: number, runDate: string, approved: ApprovedLine[]): PurchaseOrderLine[] {
  const ymd = runDate.replaceAll("-", "");
  return [...approved]
    .filter((a) => a.quantity > 0)
    .sort((a, b) => a.distributorId.localeCompare(b.distributorId) || a.skuId.localeCompare(b.skuId))
    .map((a) => ({
      poDate: runDate,
      poNumber: `FR-${ymd}-R${runId}-${a.distributorId}`,
      vendorName: vendorFor(a),
      referenceNumber: `Demand run #${runId}`,
      itemName: a.skuName,
      sku: a.skuId,
      quantity: a.quantity,
      usageUnit: a.unitOfMeasure,
      notes: a.decision === "CHANGE_QTY" ? `Qty changed by Raghav: ${a.decisionReason ?? ""}` : "Approved as recommended",
    }));
}

/** Who the PO is addressed to. Pilot default: the SKU's distributor (PO_VENDOR_SOURCE=distributor). */
function vendorFor(a: ApprovedLine): string {
  return a.distributorName;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toZohoCsv(lines: PurchaseOrderLine[]): string {
  const rows = lines.map((l) =>
    [l.poDate, l.poNumber, l.vendorName, l.referenceNumber, l.itemName, l.sku, l.quantity, "", l.usageUnit, "Draft", l.notes]
      .map(csvCell)
      .join(","),
  );
  return [ZOHO_PO_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

export type SubmitResult = { channel: "csv"; exportId: number; csv: string; poCount: number; lineCount: number };

/** THE single swap point for a live Zoho integration. */
export async function submitPurchaseOrders(runId: number, lines: PurchaseOrderLine[], createdBy: string): Promise<SubmitResult> {
  const csv = toZohoCsv(lines);
  const poCount = new Set(lines.map((l) => l.poNumber)).size;
  const { rows } = await getPool().query<{ id: number }>(
    `insert into zoho_exports (run_id, created_by, po_count, line_count, csv) values ($1,$2,$3,$4,$5) returning id`,
    [runId, createdBy, poCount, lines.length, csv],
  );
  return { channel: "csv", exportId: rows[0].id, csv, poCount, lineCount: lines.length };
}
