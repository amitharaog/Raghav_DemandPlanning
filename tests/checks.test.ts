import { describe, expect, it } from "vitest";
import { dataChecks } from "@/lib/checks";
import { killCall } from "@/lib/killCriteria";
import type { RunStats } from "@/lib/queries";
import { flat, snapshot } from "./fixtures";

const healthy = () => snapshot(Array.from({ length: 20 }, () => ({ sales: flat(100), stock: 900 })));

describe("data kill switch", () => {
  it("passes fresh, complete data (with the open-PO warning)", () => {
    const c = dataChecks(healthy(), null);
    expect(c.halts).toEqual([]);
    expect(c.warnings[0]).toMatch(/No open purchase orders loaded/);
    expect(c.salesRowsInWindow).toBe(240);
  });
  it("halts on a stale stock snapshot", () => {
    const s = healthy();
    for (const v of Object.values(s.stock)) v.asOfDate = "2026-10-15";
    expect(dataChecks(s, null).halts[0]).toMatch(/Stock snapshot is 7 days old/);
  });
  it("halts when the latest sales week is missing", () => {
    const s = snapshot([{ sales: flat(100), stock: 900 }], { runDate: "2026-10-29" });
    expect(dataChecks(s, null).halts[0]).toMatch(/Sales data is stale: .* 2026-W42, .* 2026-W43/);
  });
  it("halts when more than 5% of SKUs have no stock or sales, warns below that", () => {
    const s = healthy();
    delete s.stock[s.skus[0].skuId];
    expect(dataChecks(s, null).halts).toEqual([]); // 1 of 20 = 5%
    delete s.stock[s.skus[1].skuId];
    expect(dataChecks(s, null).halts[0]).toMatch(/2 of 20 SKUs \(10%\)/);
  });
  it("halts when sales rows drop more than 20% vs the last run", () => {
    expect(dataChecks(healthy(), { salesRowsInWindow: 240 }).halts).toEqual([]);
    expect(dataChecks(healthy(), { salesRowsInWindow: 310 }).halts[0]).toMatch(/fell 23%/);
  });
  it("halts when the last load had rows with unknown IDs", () => {
    const s = healthy();
    s.latestLoad!.rejected = [{ file: "weekly_sales.csv", reason: "SKU_ID SKU999 is not in the master" }];
    expect(dataChecks(s, null).halts[0]).toMatch(/not in the master/);
  });
});

describe("kill call", () => {
  const run = (o: Partial<RunStats>): RunStats => ({
    id: 1, runDate: "2026-10-22", trigger: "manual", triggeredBy: null, startedAt: "", finishedAt: null, status: "completed",
    haltReasons: [], warnings: [], error: null, skuCount: 100, flagCounts: { HIGH_DEMAND: 5, STOCKOUT: 10, OVERSTOCK: 5, OK: 62, JUDGMENT: 18 },
    reasonsReport: null, hasExtract: true, decided: 100, approved: 90, changed: 5, held: 5, overrides: 8, ruleBasedDecided: 82,
    reasonsMarkedWrong: 2, llmReasons: 0, zohoExports: 1, poLines: 10, ...o,
  });

  it("continues when every limit is met", () => {
    const c = killCall([run({})], [{ id: 1, periodLabel: "Q3", stockoutLossLakh: 16, writeoffLossLakh: 8, enteredAt: "" }], "2026-10-22");
    expect(c.verdict).toBe("CONTINUE");
  });
  it("kills when Raghav overrides more than 30% of rule results", () => {
    const c = killCall([run({ overrides: 30 })], [], "2026-10-22");
    expect(c.verdict).toBe("KILL");
    expect(c.headline).toMatch(/rule results raghav changed or held/);
  });
  it("kills at day 90 when losses fell less than 15%", () => {
    const outcome = [{ id: 1, periodLabel: "Q3", stockoutLossLakh: 20, writeoffLossLakh: 9, enteredAt: "" }]; // 29 vs 31 = -6%
    expect(killCall([run({})], outcome, "2026-11-30").verdict).toBe("WATCH"); // day 40
    expect(killCall([run({})], outcome, "2027-01-20").verdict).toBe("KILL"); // day 91
  });
  it("kills after two halted runs in a row", () => {
    const halted = { status: "halted" as const, haltReasons: ["Stock snapshot is 10 days old"] };
    expect(killCall([run({}), run({ id: 2, ...halted })], [], "2026-10-29").verdict).toBe("WATCH");
    expect(killCall([run({}), run({ id: 2, ...halted }), run({ id: 3, ...halted })], [], "2026-11-02").verdict).toBe("KILL");
  });
});
