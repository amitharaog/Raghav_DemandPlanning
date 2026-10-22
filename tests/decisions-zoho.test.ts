import { describe, expect, it } from "vitest";
import { goesToPurchaseOrder, isOverride, validateDecision } from "@/lib/decisions";
import { buildPurchaseOrderLines, toZohoCsv, ZOHO_PO_COLUMNS, type ApprovedLine } from "@/lib/zoho";

describe("Raghav's decisions", () => {
  const stockout = { flag: "STOCKOUT" as const, suggestedQty: 150 };
  const judgment = { flag: "JUDGMENT" as const, suggestedQty: null };

  it("approve takes the rule quantity", () => {
    expect(validateDecision(stockout, { decision: "APPROVE" })).toEqual({ ok: true, value: { decision: "APPROVE", finalQty: 150, reason: null } });
  });
  it("judgment items cannot be approved, only given a qty or held", () => {
    expect(validateDecision(judgment, { decision: "APPROVE" }).ok).toBe(false);
    expect(validateDecision(judgment, { decision: "CHANGE_QTY", qty: 200, reason: "new launch" }).ok).toBe(true);
  });
  it("a reason is required to change or hold", () => {
    expect(validateDecision(stockout, { decision: "CHANGE_QTY", qty: 300 })).toMatchObject({ ok: false });
    expect(validateDecision(stockout, { decision: "CHANGE_QTY", qty: 300, reason: "   " })).toMatchObject({ ok: false });
    expect(validateDecision(stockout, { decision: "HOLD" })).toMatchObject({ ok: false });
    expect(validateDecision(stockout, { decision: "HOLD", reason: "shelf life" })).toMatchObject({ ok: true });
  });
  it("rejects bad quantities", () => {
    for (const qty of [-1, 1.5, null, Number.NaN]) {
      expect(validateDecision(stockout, { decision: "CHANGE_QTY", qty, reason: "x" }).ok).toBe(false);
    }
  });
  it("counts overrides only on rule-based items", () => {
    expect(isOverride("STOCKOUT", 150, { decision: "HOLD", finalQty: null, reason: "x" })).toBe(true);
    expect(isOverride("STOCKOUT", 150, { decision: "CHANGE_QTY", finalQty: 300, reason: "x" })).toBe(true);
    expect(isOverride("STOCKOUT", 150, { decision: "CHANGE_QTY", finalQty: 150, reason: "x" })).toBe(false);
    expect(isOverride("STOCKOUT", 150, { decision: "APPROVE", finalQty: 150, reason: null })).toBe(false);
    expect(isOverride("JUDGMENT", null, { decision: "HOLD", finalQty: null, reason: "x" })).toBe(false);
  });
  it("only approved/changed items with qty > 0 become purchase orders", () => {
    expect(goesToPurchaseOrder({ decision: "APPROVE", finalQty: 150, reason: null })).toBe(true);
    expect(goesToPurchaseOrder({ decision: "CHANGE_QTY", finalQty: 1, reason: "x" })).toBe(true);
    expect(goesToPurchaseOrder({ decision: "APPROVE", finalQty: 0, reason: null })).toBe(false); // approved OK / overstock
    expect(goesToPurchaseOrder({ decision: "HOLD", finalQty: null, reason: "x" })).toBe(false);
    expect(goesToPurchaseOrder(null)).toBe(false); // pending
  });
});

describe("Zoho purchase order CSV", () => {
  const line = (o: Partial<ApprovedLine>): ApprovedLine => ({
    skuId: "SKU001", skuName: "Freshroots Mango Drink 200ml", unitOfMeasure: "Units", distributorId: "DIST001",
    distributorName: "NutriFlow Distributors", quantity: 750, decision: "APPROVE", decisionReason: null, ...o,
  });

  it("groups lines into one PO per vendor and drops zero quantities", () => {
    const lines = buildPurchaseOrderLines(7, "2026-10-22", [
      line({}),
      line({ skuId: "SKU013", skuName: "Peanut Butter, 300g", quantity: 120, decision: "CHANGE_QTY", decisionReason: 'festival "top-up"' }),
      line({ skuId: "SKU003", distributorId: "DIST002", distributorName: "GrainPath Logistics", quantity: 300 }),
      line({ skuId: "SKU006", quantity: 0 }),
    ]);
    expect(lines.map((l) => [l.poNumber, l.sku, l.quantity])).toEqual([
      ["FR-20261022-R7-DIST001", "SKU001", 750],
      ["FR-20261022-R7-DIST001", "SKU013", 120],
      ["FR-20261022-R7-DIST002", "SKU003", 300],
    ]);
    const csv = toZohoCsv(lines).split("\r\n");
    expect(csv[0]).toBe(ZOHO_PO_COLUMNS.join(","));
    expect(csv[1]).toBe("2026-10-22,FR-20261022-R7-DIST001,NutriFlow Distributors,Demand run #7,Freshroots Mango Drink 200ml,SKU001,750,,Units,Draft,Approved as recommended");
    expect(csv[2]).toBe('2026-10-22,FR-20261022-R7-DIST001,NutriFlow Distributors,Demand run #7,"Peanut Butter, 300g",SKU013,120,,Units,Draft,"Qty changed by Raghav: festival ""top-up"""');
    expect(csv).toHaveLength(5); // header + 3 lines + trailing newline
  });
});
