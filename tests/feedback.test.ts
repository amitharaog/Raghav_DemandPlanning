import { describe, expect, it } from "vitest";
import { buildFeedback, forecastCheck, qtyRatio, ruleFeedback, skuPatterns, type Fact } from "@/lib/feedback";

const fact = (o: Partial<Fact>): Fact => ({
  runId: 1, runDate: "2026-10-22", skuId: "SKU001", skuName: "Mango Drink", flag: "HIGH_DEMAND", suggestedQty: 750,
  decision: "APPROVE", finalQty: 750, decisionReason: null, reasonSource: "template", reasonMarkedWrong: false,
  isFestival: false, forecastWeekly: null, actualWeekly: null, weeksObserved: 0, ...o,
});

describe("feedback: Raghav's decisions", () => {
  it("measures a quantity change against the suggestion", () => {
    expect(qtyRatio(fact({ decision: "CHANGE_QTY", finalQty: 900 }))).toBeCloseTo(1.2);
    expect(qtyRatio(fact({ decision: "APPROVE" }))).toBeNull();
    expect(qtyRatio(fact({ decision: "CHANGE_QTY", suggestedQty: null, finalQty: 100 }))).toBeNull();
  });

  it("counts overrides per rule, but not for judgment items", () => {
    const rules = ruleFeedback([
      fact({ decision: "APPROVE" }),
      fact({ decision: "CHANGE_QTY", finalQty: 900 }),
      fact({ decision: "HOLD", finalQty: null }),
      fact({ decision: null }),
      fact({ flag: "JUDGMENT", suggestedQty: null, decision: "CHANGE_QTY", finalQty: 50 }),
    ]);
    const hd = rules.find((r) => r.flag === "HIGH_DEMAND")!;
    expect(hd).toMatchObject({ results: 4, decided: 3, approved: 1, changed: 1, held: 1 });
    expect(hd.overrideRate).toBeCloseTo(2 / 3);
    expect(rules.find((r) => r.flag === "JUDGMENT")!.overrideRate).toBeNull();
  });

  it("suggests a new High demand multiplier only when the pattern is consistent", () => {
    const raised = Array.from({ length: 6 }, (_, i) => fact({ runId: i + 1, skuId: `S${i}`, decision: "CHANGE_QTY", finalQty: 900 }));
    const fb = buildFeedback(raised);
    const s = fb.suggestions.find((x) => x.id === "high-demand-multiplier")!;
    expect(s.title).toMatch(/raised by about 20%/);
    expect(s.change).toBe("rules-config.ts: highDemandQtyMultiplier 1.5 → 1.8");
    // Four decisions is too few to act on.
    expect(buildFeedback(raised.slice(0, 4)).suggestions.find((x) => x.id === "high-demand-multiplier")).toBeUndefined();
  });

  it("flags Overstock results that Raghav orders anyway", () => {
    const facts = Array.from({ length: 5 }, (_, i) =>
      fact({ runId: i + 1, skuId: `S${i}`, flag: "OVERSTOCK", suggestedQty: null, decision: i < 2 ? "CHANGE_QTY" : "APPROVE", finalQty: i < 2 ? 100 : null }),
    );
    expect(buildFeedback(facts).suggestions.map((s) => s.id)).toContain("overstock-threshold");
  });

  it("spots a SKU changed the same way run after run", () => {
    const facts = [
      fact({ runId: 1, decision: "APPROVE" }),
      fact({ runId: 2, decision: "CHANGE_QTY", finalQty: 1000 }),
      fact({ runId: 3, decision: "CHANGE_QTY", finalQty: 1050 }),
      fact({ runId: 3, skuId: "SKU002", decision: "CHANGE_QTY", finalQty: 1000 }),
    ];
    expect(skuPatterns(facts)).toEqual([{ skuId: "SKU001", skuName: "Mango Drink", runs: 2, medianRatio: 1.3666666666666667, lastQty: 1050, suggestedQty: 750 }]);
    // A change in the other direction breaks the streak.
    expect(skuPatterns([...facts, fact({ runId: 4, decision: "CHANGE_QTY", finalQty: 400 })])).toEqual([]);
  });
});

describe("feedback: forecast against what sold", () => {
  it("measures error and bias, and keeps unmeasured forecasts as pending", () => {
    const c = forecastCheck([
      fact({ forecastWeekly: 100, actualWeekly: 120, weeksObserved: 4 }),
      fact({ skuId: "SKU002", forecastWeekly: 100, actualWeekly: 90, weeksObserved: 2 }),
      fact({ skuId: "SKU003", forecastWeekly: 50, actualWeekly: null, weeksObserved: 0 }),
      fact({ skuId: "SKU004", forecastWeekly: null }),
    ]);
    expect(c.measured).toBe(2);
    expect(c.pending).toBe(1);
    expect(c.error).toBeCloseTo(30 / 200);
    expect(c.bias).toBeCloseTo(10 / 200);
    expect(c.misses[0]).toMatchObject({ skuId: "SKU001", miss: 0.2 });
  });

  it("suggests a festival uplift when festival-month sales keep beating the forecast", () => {
    const facts = Array.from({ length: 8 }, (_, i) =>
      fact({ skuId: `S${i}`, isFestival: true, forecastWeekly: 100, actualWeekly: 130, weeksObserved: 4 }),
    );
    const s = buildFeedback(facts).suggestions.find((x) => x.id === "forecast-bias")!;
    expect(s.title).toBe("Sales came in 30% above what the rules expected");
    expect(s.change).toBe("rules-config.ts: festivalUplift 1.25 → 1.63");
  });

  it("stays quiet with no actuals yet", () => {
    const fb = buildFeedback([fact({ forecastWeekly: 100 })]);
    expect(fb.forecast.measured).toBe(0);
    expect(fb.suggestions).toEqual([]);
  });
});
