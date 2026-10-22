import { describe, expect, it } from "vitest";
import { applyRules } from "@/lib/rules";
import { checkReason, templateReason, writeReasons, type LlmClient } from "@/lib/reasons";
import { computeTrend } from "@/lib/trends";
import { flat, snapshot } from "./fixtures";

const snap = snapshot(
  [
    { sales: [...flat(100, 12), ...flat(150, 4)], stock: 300 }, // high demand + stockout
    { sales: flat(100), stock: 500 }, // stockout
    { sales: flat(100), stock: 2000 }, // overstock
    { sales: flat(100), stock: 900 }, // ok
    { sales: flat(100, 5), stock: 900 }, // judgment
    ...Array.from({ length: 15 }, () => ({ sales: flat(100), stock: 900 })),
  ],
  { festival: true },
);
const items = snap.skus.map((sku) => ({ sku, rec: applyRules(sku, computeTrend(snap, sku)) }));

describe("template reasons", () => {
  it("pass their own number check, for every flag", () => {
    for (const { rec, sku } of items) {
      expect(checkReason(templateReason(rec, sku), rec, sku), templateReason(rec, sku)).toBeNull();
    }
  });
  it("explain the judgment reasons", () => {
    expect(templateReason(items[4].rec, items[4].sku)).toMatch(/^Needs your call: only 5 week/);
  });
});

describe("LLM reason checks", () => {
  const { rec, sku } = items[1]; // stockout, qty 100, 4 weeks at 125/week
  it("accepts a reason that only uses the rule's numbers (rounded)", () => {
    expect(checkReason("Only 4 weeks of stock at 125 units a week in festival season, under the 6-week floor; reorder 100 units.", rec, sku)).toBeNull();
  });
  it("rejects an invented quantity", () => {
    expect(checkReason("Reorder 250 units now to be safe.", rec, sku)).toMatch(/mentions 250/);
  });
  it("rejects an empty or long reason", () => {
    expect(checkReason("  ", rec, sku)).toBe("empty");
    expect(checkReason("x".repeat(401), rec, sku)).toMatch(/longer/);
  });
});

describe("writeReasons", () => {
  const good: LlmClient = async (_s, json) =>
    JSON.parse(json).items.map((i: { sku_id: string; suggested_qty: number | null }) => ({
      sku_id: i.sku_id,
      text: i.suggested_qty ? `Order ${i.suggested_qty} units as the rule says.` : "Rule result stands.",
    }));

  it("uses LLM text when it passes, and never changes flags or quantities", async () => {
    const before = JSON.stringify(items.map((i) => i.rec));
    const { reasons, report } = await writeReasons(items, { client: good, model: "test" });
    expect(report.mode).toBe("llm");
    expect(report.llmReasons).toBe(items.length);
    expect(reasons.get(items[1].rec.skuId)).toEqual({ text: "Order 100 units as the rule says.", source: "llm" });
    expect(JSON.stringify(items.map((i) => i.rec))).toBe(before);
  });

  it("replaces a single bad reason with the template", async () => {
    const oneBad: LlmClient = async (s, json) => {
      const out = await good(s, json);
      out[1] = { ...out[1], text: "Order 999 units." };
      return out;
    };
    const { reasons, report } = await writeReasons(items, { client: oneBad, model: "test" });
    expect(report.killed).toBe(false);
    expect(report.rejectedLlmReasons).toHaveLength(1);
    expect(reasons.get(items[1].rec.skuId)?.source).toBe("template");
  });

  it("trips the AI kill switch when more than 10% of reasons are bad", async () => {
    const bad: LlmClient = async (_s, json) =>
      JSON.parse(json).items.map((i: { sku_id: string }, n: number) => ({ sku_id: i.sku_id, text: n < 3 ? "Order 12345 units." : "Fine." }));
    const { reasons, report } = await writeReasons(items, { client: bad, model: "test" });
    expect(report.killed).toBe(true);
    expect(report.note).toMatch(/AI kill switch tripped: 3 of 20/);
    expect([...reasons.values()].every((r) => r.source === "template")).toBe(true);
  });

  it("falls back to templates when the API fails", async () => {
    const down: LlmClient = async () => {
      throw new Error("503 overloaded");
    };
    const { reasons, report } = await writeReasons(items, { client: down, model: "test" });
    expect(report.killed).toBe(true);
    expect(report.note).toMatch(/503 overloaded/);
    expect(reasons.size).toBe(items.length);
  });

  it("is template-only when switched off", async () => {
    const { report } = await writeReasons(items, { client: null, disabledNote: "off" });
    expect(report).toMatchObject({ mode: "template-only", note: "off", llmReasons: 0 });
  });
});
