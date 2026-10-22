import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { applyRules, type Recommendation } from "@/lib/rules";
import { parseCalendar, parseDistributors, parseInventory, parseSkus, parseWeeklySales } from "@/lib/sapFiles";
import { lastCompleteWeekStart, type Snapshot } from "@/lib/snapshot";
import { computeTrend } from "@/lib/trends";
import { flat, snapshot } from "./fixtures";

/** Runs trends + rules for the single SKU in a one-SKU snapshot. */
function run(c: Parameters<typeof snapshot>[0][number], opts?: Parameters<typeof snapshot>[1]): Recommendation {
  const snap = snapshot([c], opts);
  return applyRules(snap.skus[0], computeTrend(snap, snap.skus[0]));
}

/** 12 weeks at `base` with the last 4 at `recent` (16 weeks total). */
const trend = (base: number, recent: number) => [...flat(base, 12), ...flat(recent, 4)];

describe("a. festival uplift (x1.25 before thresholds)", () => {
  it("turns a 7-week SKU into a stockout risk in a festival month", () => {
    const normal = run({ sales: flat(100), stock: 700 });
    const festival = run({ sales: flat(100), stock: 700 }, { festival: true });
    expect(normal.flag).toBe("OK");
    expect(normal.numbers.weeksOfStock).toBeCloseTo(7);
    expect(festival.flag).toBe("STOCKOUT");
    expect(festival.numbers.forecastWeekly).toBeCloseTo(125);
    expect(festival.numbers.weeksOfStock).toBeCloseTo(5.6);
  });

  it("pulls a SKU out of overstock (uplift is applied before the >14 check)", () => {
    expect(run({ sales: flat(100), stock: 1450 }).flag).toBe("OVERSTOCK"); // 14.5 weeks
    expect(run({ sales: flat(100), stock: 1450 }, { festival: true }).flag).toBe("OK"); // 11.6 weeks
  });

  it("does not change the 4-wk vs 12-wk comparison", () => {
    const r = run({ sales: trend(100, 115), stock: 900 }, { festival: true });
    expect(r.numbers.ratio4to12).toBeCloseTo(115 / 105);
    expect(r.flag).not.toBe("HIGH_DEMAND");
    expect(r.numbers.weeksOfStockRaw).toBeCloseTo(900 / 115);
  });
});

describe("b. high demand (4-wk avg > 20% above 12-wk avg)", () => {
  // 12-wk window = 8 weeks at base + 4 recent weeks.
  it("flags High demand and orders 1.5x standard qty", () => {
    const r = run({ sales: trend(100, 150), stock: 1000 }); // avg12 = 116.7, ratio 1.286
    expect(r.flag).toBe("HIGH_DEMAND");
    expect(r.action).toBe("REORDER");
    expect(r.suggestedQty).toBe(150);
    expect(r.ruleFired).toMatch(/^b\. High demand/);
  });

  it("boundary: avg4 exactly 1.2 x avg12 is not high, a hair above is", () => {
    // 8 weeks at 90 then 4 at 120: avg12 = (720 + 480) / 12 = 100, avg4 = 120 = exactly 1.2 x avg12.
    const exact = run({ sales: [...flat(90, 8), ...flat(120, 4)], stock: 1000 }); // 12 weeks of history exactly
    expect(exact.numbers.ratio4to12).toBeCloseTo(1.2, 10);
    expect(exact.flag).not.toBe("HIGH_DEMAND");
    const above = run({ sales: [...flat(90, 8), 120, 120, 120, 121], stock: 1000 });
    expect(above.flag).toBe("HIGH_DEMAND");
  });

  it("rounds 1.5x up to a whole unit", () => {
    expect(run({ sku: { standardReorderQty: 155 }, sales: trend(100, 150), stock: 1000 }).suggestedQty).toBe(233);
  });

  it("High demand + Stockout risk agree: High demand at 1.5x, stockout noted", () => {
    const r = run({ sales: trend(100, 150), stock: 300 });
    expect(r.flag).toBe("HIGH_DEMAND");
    expect(r.suggestedQty).toBe(150);
    expect(r.alsoFlagged).toEqual(["STOCKOUT"]);
    expect(r.ruleFired).toMatch(/Stockout risk agrees/);
  });
});

describe("c. standard SKUs (< 6 weeks stockout, > 14 weeks overstock)", () => {
  it("stockout risk below 6 weeks: reorder standard qty now", () => {
    const r = run({ sales: flat(100), stock: 599 });
    expect(r.flag).toBe("STOCKOUT");
    expect(r.action).toBe("REORDER");
    expect(r.suggestedQty).toBe(100);
    expect(r.ruleFired).toMatch(/^c\. Stockout risk/);
  });
  it("exactly 6 and exactly 14 weeks are OK", () => {
    expect(run({ sales: flat(100), stock: 600 }).flag).toBe("OK");
    expect(run({ sales: flat(100), stock: 1400 }).flag).toBe("OK");
  });
  it("overstock above 14 weeks: pause next order, qty 0", () => {
    const r = run({ sales: flat(100), stock: 1401 });
    expect(r.flag).toBe("OVERSTOCK");
    expect(r.action).toBe("PAUSE");
    expect(r.suggestedQty).toBe(0);
  });
  it("counts stock on order", () => {
    expect(run({ sales: flat(100), stock: 300 }).flag).toBe("STOCKOUT");
    const r = run({ sales: flat(100), stock: 300, onOrder: 400 });
    expect(r.numbers.weeksOfStock).toBeCloseTo(7);
    expect(r.flag).toBe("OK");
  });
  it("shows weeks of cover after the suggested order", () => {
    expect(run({ sales: flat(100), stock: 300 }).numbers.coverAfterOrder).toBeCloseTo(4);
  });
});

describe("d. high-perishability SKUs (< 3 weeks stockout, > 4 weeks overstock)", () => {
  const perishable = { perishability: "High" as const };
  it("uses the tighter limits", () => {
    expect(run({ sku: perishable, sales: flat(100), stock: 299 }).flag).toBe("STOCKOUT");
    expect(run({ sku: perishable, sales: flat(100), stock: 300 }).flag).toBe("OK");
    expect(run({ sku: perishable, sales: flat(100), stock: 400 }).flag).toBe("OK");
    const over = run({ sku: perishable, sales: flat(100), stock: 401 });
    expect(over.flag).toBe("OVERSTOCK");
    expect(over.ruleFired).toMatch(/^d\. Overstock risk/);
  });
  it("5 weeks is a stockout for a standard SKU but an overstock for a perishable one", () => {
    expect(run({ sales: flat(100), stock: 500 }).flag).toBe("STOCKOUT");
    expect(run({ sku: perishable, sales: flat(100), stock: 500 }).flag).toBe("OVERSTOCK");
  });
  it("festival uplift applies to perishables too", () => {
    // 350 / 100 = 3.5 weeks (OK); 350 / 125 = 2.8 weeks (stockout)
    expect(run({ sku: perishable, sales: flat(100), stock: 350 }).flag).toBe("OK");
    expect(run({ sku: perishable, sales: flat(100), stock: 350 }, { festival: true }).flag).toBe("STOCKOUT");
  });
});

describe("e. needs Raghav's judgment", () => {
  it("under 12 weeks of history (new launch)", () => {
    const r = run({ sales: flat(100, 11), stock: 300 });
    expect(r.flag).toBe("JUDGMENT");
    expect(r.action).toBe("REVIEW");
    expect(r.suggestedQty).toBeNull();
    expect(r.judgmentReasons[0]).toMatch(/only 11 week/);
    expect(r.alsoFlagged).toContain("STOCKOUT"); // shown to Raghav, but not acted on
    expect(run({ sales: flat(100, 12), stock: 300 }).flag).toBe("STOCKOUT");
  });

  it("uses the launch date when the SKU master has one", () => {
    const r = run({ sku: { launchDate: "2026-08-24" }, sales: flat(100), stock: 800 });
    expect(r.numbers.weeksOfHistory).toBe(8);
    expect(r.flag).toBe("JUDGMENT");
  });

  it("missing weeks inside the 12-week window", () => {
    const sales: (number | null)[] = flat(100);
    sales[10] = null;
    const r = run({ sales, stock: 800 });
    expect(r.flag).toBe("JUDGMENT");
    expect(r.judgmentReasons[0]).toMatch(/missing sales data for 2026-W37/);
  });

  it("a missing week before the 12-week window does not matter", () => {
    const sales: (number | null)[] = flat(100);
    sales[1] = null;
    expect(run({ sales, stock: 800 }).flag).toBe("OK");
  });

  it("missing stock figure", () => {
    const r = run({ sales: flat(100), stock: null });
    expect(r.flag).toBe("JUDGMENT");
    expect(r.judgmentReasons).toContain("no stock figure in the SAP export");
  });

  it("conflicting flags: High demand + Overstock risk", () => {
    const r = run({ sales: trend(30, 55), stock: 4000 });
    expect(r.flag).toBe("JUDGMENT");
    expect(r.judgmentReasons[0]).toMatch(/flags conflict: High demand .* but Overstock risk/);
    expect(r.suggestedQty).toBeNull();
  });

  it("zero sales for all 16 weeks: no divide-by-zero, goes to judgment", () => {
    const r = run({ sales: flat(0), stock: 500 });
    expect(r.flag).toBe("JUDGMENT");
    expect(r.numbers.weeksOfStock).toBeNull();
    expect(r.judgmentReasons[0]).toMatch(/zero sales in the last 4 weeks/);
  });

  it("sales dropped to zero in the last 4 weeks: judgment, not a silent overstock", () => {
    const r = run({ sales: trend(100, 0), stock: 500 });
    expect(r.flag).toBe("JUDGMENT");
    expect(r.numbers.avg12).toBeCloseTo(800 / 12);
  });

  it("no history at all (SKU in master, never sold)", () => {
    const snap = snapshot([{ sales: flat(100) }]);
    snap.skus.push({ ...snap.skus[0], skuId: "SKU999" });
    const r = applyRules(snap.skus[1], computeTrend(snap, snap.skus[1]));
    expect(r.flag).toBe("JUDGMENT");
    expect(r.numbers.weeksOfHistory).toBe(0);
    expect(r.judgmentReasons).toEqual([
      "only 0 week(s) of sales history (rules need 12)",
      "no stock figure in the SAP export",
      "no sales in the 12-week window",
    ]);
  });

  it("every recommendation carries a rule and a trace", () => {
    for (const c of [{ sales: flat(100), stock: 100 }, { sales: flat(100, 3), stock: 100 }]) {
      const r = run(c);
      expect(r.ruleFired.length).toBeGreaterThan(0);
      expect(r.ruleTrace[0]).toMatch(/^(a|e)\./);
    }
  });
});

describe("the real seed data (run date 2026-10-22, October = festival month)", () => {
  function seedSnapshot(dirs: string[]): Snapshot {
    const runDate = "2026-10-22";
    const read = (d: string, f: string) => (fs.existsSync(`${d}/${f}`) ? fs.readFileSync(`${d}/${f}`, "utf8") : null);
    const snap: Snapshot = {
      runDate,
      lastCompleteWeek: lastCompleteWeekStart(runDate),
      weeks: [],
      skus: [],
      sales: {},
      stock: {},
      onOrder: {},
      openPoAsOf: null,
      festival: { isFestivalMonth: false, source: "calendar" },
      latestLoad: null,
    };
    const dists = new Map(parseDistributors(read("seed-data", "distributor_master.csv")!).rows.map((d) => [d.distributorId, d]));
    const weeks = new Set<string>();
    for (const d of dirs) {
      for (const s of parseSkus(read(d, "sku_master.csv")!).rows) {
        snap.skus.push({ ...s, distributorName: dists.get(s.distributorId)!.distributorName });
      }
      for (const r of parseWeeklySales(read(d, "weekly_sales.csv")!).rows) {
        (snap.sales[r.skuId] ??= {})[r.weekStart] = r.unitsSold;
        weeks.add(r.weekStart);
      }
      for (const r of parseInventory(read(d, "current_inventory.csv")!).rows) {
        snap.stock[r.skuId] = { unitsOnHand: r.unitsOnHand, asOfDate: r.asOfDate, locations: [r.location] };
      }
    }
    const cal = parseCalendar(read("seed-data", "calendar.csv")!).rows.find((c) => c.yearMonth === "2026-10")!;
    snap.festival.isFestivalMonth = cal.isFestivalMonth;
    snap.weeks = [...weeks].sort();
    return snap;
  }

  const results = (snap: Snapshot) =>
    Object.fromEntries(snap.skus.map((s) => [s.skuId, applyRules(s, computeTrend(snap, s))]));

  it("gives the expected flag for every real SKU", () => {
    const snap = seedSnapshot(["seed-data"]);
    expect(snap.lastCompleteWeek).toBe("2026-10-12");
    expect(snap.festival.isFestivalMonth).toBe(true);
    const r = results(snap);
    const byFlag = (f: string) => Object.values(r).filter((x) => x.flag === f).map((x) => x.skuId);
    expect(byFlag("HIGH_DEMAND")).toEqual(["SKU001"]);
    expect(byFlag("STOCKOUT")).toEqual(["SKU003", "SKU004", "SKU011", "SKU013"]);
    expect(byFlag("OVERSTOCK")).toEqual(["SKU006"]);
    expect(byFlag("JUDGMENT")).toEqual([]);
    expect(byFlag("OK")).toHaveLength(9);
    expect(r.SKU001.suggestedQty).toBe(750);
    expect(r.SKU001.alsoFlagged).toEqual(["STOCKOUT"]);
    expect(r.SKU001.numbers.avg4).toBeCloseTo(261);
    expect(r.SKU001.numbers.weeksOfStock).toBeCloseTo(2.76, 2);
    expect(r.SKU004.ruleFired).toMatch(/^d\./); // perishable limits
    expect(r.SKU002.numbers.weeksOfStockRaw).toBeCloseTo(14.33, 2); // would be overstock without the uplift
    expect(r.SKU002.flag).toBe("OK");
  });

  it("sends the three demo SKUs to judgment, one for each reason", () => {
    const r = results(seedSnapshot(["seed-data", "seed-data/demo"]));
    expect(r.SKU016.judgmentReasons[0]).toMatch(/only 6 week/); // launched Mon 2026-09-07 = W37..W42
    expect(r.SKU017.judgmentReasons[0]).toMatch(/missing sales data for 2026-W36, 2026-W39, 2026-W40/);
    expect(r.SKU018.judgmentReasons[0]).toMatch(/flags conflict/);
  });
});
