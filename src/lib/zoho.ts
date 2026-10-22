// Step 6 - Zoho: purchase orders for approved items only.
//
// `submitPurchaseOrders` is the one place that sends POs. Without a Zoho
// connection it writes a CSV in Zoho Inventory's purchase order import layout;
// once Zoho is connected (see zohoApi.ts) it creates each PO as a Draft in Zoho
// Inventory, where procurement still has to issue it.

import { getPool } from "./db";
import { createDraftPurchaseOrder, zohoSession, type DraftPo } from "./zohoApi";

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

export type PoResult = {
  poNumber: string;
  vendorName: string;
  status: "created" | "failed" | "skipped";
  zohoPoNumber?: string | null;
  error?: string | null;
};

export type SubmitResult = {
  channel: "csv" | "zoho";
  exportId: number;
  csv: string;
  poCount: number;
  lineCount: number;
  results: PoResult[];
};

/**
 * THE single swap point for purchase orders.
 * channel "csv": stores a Zoho import CSV. channel "zoho": creates each PO as a
 * Draft in Zoho Inventory (one per vendor), skipping any PO number already
 * created, and stores the CSV too as an audit copy.
 */
export async function submitPurchaseOrders(
  runId: number,
  lines: PurchaseOrderLine[],
  createdBy: string,
  channel: "csv" | "zoho" = "csv",
): Promise<SubmitResult> {
  const csv = toZohoCsv(lines);
  const pos = groupByPo(lines);
  const session = channel === "zoho" ? await zohoSession() : null;
  const { rows } = await getPool().query<{ id: number }>(
    `insert into zoho_exports (run_id, created_by, po_count, line_count, csv, channel) values ($1,$2,$3,$4,$5,$6) returning id`,
    [runId, createdBy, pos.length, lines.length, csv, channel],
  );
  const exportId = rows[0].id;
  const results: PoResult[] = [];

  if (session) {
    for (const po of pos) {
      const done = await getPool().query(
        `select zoho_po_number from zoho_po_results where po_number = $1 and status = 'created' limit 1`,
        [po.poNumber],
      );
      let r: PoResult;
      if (done.rows[0]) {
        r = { poNumber: po.poNumber, vendorName: po.vendorName, status: "skipped", zohoPoNumber: done.rows[0].zoho_po_number, error: "Already in Zoho" };
      } else {
        try {
          const created = await createDraftPurchaseOrder(session, po);
          r = { poNumber: po.poNumber, vendorName: po.vendorName, status: "created", zohoPoNumber: created.number };
          await getPool().query(
            `insert into zoho_po_results (export_id, po_number, vendor_name, status, zoho_po_id, zoho_po_number) values ($1,$2,$3,'created',$4,$5)`,
            [exportId, po.poNumber, po.vendorName, created.id, created.number],
          );
          results.push(r);
          continue;
        } catch (err) {
          r = { poNumber: po.poNumber, vendorName: po.vendorName, status: "failed", error: (err as Error).message };
        }
      }
      await getPool().query(
        `insert into zoho_po_results (export_id, po_number, vendor_name, status, zoho_po_number, error) values ($1,$2,$3,$4,$5,$6)`,
        [exportId, po.poNumber, po.vendorName, r.status, r.zohoPoNumber ?? null, r.error ?? null],
      );
      results.push(r);
    }
  }
  return { channel, exportId, csv, poCount: pos.length, lineCount: lines.length, results };
}

/** One draft PO per PO number (= one vendor per run). */
export function groupByPo(lines: PurchaseOrderLine[]): DraftPo[] {
  const byPo = new Map<string, DraftPo>();
  for (const l of lines) {
    const po = byPo.get(l.poNumber) ?? {
      poNumber: l.poNumber,
      vendorName: l.vendorName,
      date: l.poDate,
      reference: l.referenceNumber,
      notes: "Raised from the Freshroots demand planning tool after Raghav's review.",
      lines: [],
    };
    po.lines.push({ sku: l.sku, quantity: l.quantity });
    if (l.notes.startsWith("Qty changed")) po.notes += ` ${l.sku}: ${l.notes}.`;
    byPo.set(l.poNumber, po);
  }
  return [...byPo.values()];
}
