// Step 5 - Raghav's call: what counts as a valid decision. Pure, so it is tested
// without a database and the API and the page apply exactly the same rules.

import type { Flag } from "./rules";

export type DecisionKind = "APPROVE" | "CHANGE_QTY" | "HOLD";
export type DecisionInput = { decision: DecisionKind; qty?: number | null; reason?: string | null };
export type Decided = { decision: DecisionKind; finalQty: number | null; reason: string | null };

export function validateDecision(
  rec: { flag: Flag; suggestedQty: number | null },
  input: DecisionInput,
): { ok: true; value: Decided } | { ok: false; error: string } {
  const reason = input.reason?.trim() || null;
  switch (input.decision) {
    case "APPROVE":
      if (rec.flag === "JUDGMENT" || rec.suggestedQty === null) {
        return { ok: false, error: "There is no rule quantity to approve. Use Change qty to set one, or Hold." };
      }
      return { ok: true, value: { decision: "APPROVE", finalQty: rec.suggestedQty, reason } };
    case "CHANGE_QTY": {
      const qty = input.qty;
      if (qty === undefined || qty === null || !Number.isInteger(qty) || qty < 0) {
        return { ok: false, error: "Enter a whole-number quantity of 0 or more." };
      }
      if (!reason) return { ok: false, error: "A reason is required when you change the quantity." };
      return { ok: true, value: { decision: "CHANGE_QTY", finalQty: qty, reason } };
    }
    case "HOLD":
      if (!reason) return { ok: false, error: "A reason is required to hold an item." };
      return { ok: true, value: { decision: "HOLD", finalQty: null, reason } };
    default:
      return { ok: false, error: `Unknown decision "${(input as { decision: string }).decision}".` };
  }
}

/** An override = Raghav disagreed with a rule-based result. Judgment items are his call anyway. */
export function isOverride(flag: Flag, suggestedQty: number | null, d: Decided | null): boolean {
  if (!d || flag === "JUDGMENT") return false;
  if (d.decision === "HOLD") return true;
  return d.decision === "CHANGE_QTY" && d.finalQty !== suggestedQty;
}

/** Only these go to Zoho: approved or changed, with a quantity above zero. */
export function goesToPurchaseOrder(d: Decided | null): boolean {
  return !!d && (d.decision === "APPROVE" || d.decision === "CHANGE_QTY") && (d.finalQty ?? 0) > 0;
}
