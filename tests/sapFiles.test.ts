import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { keepKnown, parseCalendar, parseInventory, parseSkus, parseWeeklySales } from "@/lib/sapFiles";
import { isoWeekToMonday, mondayToIsoWeek } from "@/lib/weeks";

describe("ISO weeks", () => {
  it("maps the seed weeks to Mondays", () => {
    expect(isoWeekToMonday("2026-W27")).toBe("2026-06-29");
    expect(isoWeekToMonday("2026-W42")).toBe("2026-10-12");
    expect(isoWeekToMonday("2026-W01")).toBe("2025-12-29"); // week 1 can start in the previous year
  });
  it("round-trips", () => {
    for (const w of ["2025-W01", "2026-W27", "2026-W53", "2027-W10"]) {
      expect(mondayToIsoWeek(isoWeekToMonday(w))).toBe(w);
    }
  });
  it("rejects bad weeks", () => {
    expect(() => isoWeekToMonday("2026-27")).toThrow();
    expect(() => isoWeekToMonday("2025-W53")).toThrow(/no week 53/);
  });
});

describe("SAP file parsers", () => {
  it("parses the real seed files with no rejects", () => {
    const sales = parseWeeklySales(fs.readFileSync("seed-data/weekly_sales.csv", "utf8"));
    const skus = parseSkus(fs.readFileSync("seed-data/sku_master.csv", "utf8"));
    expect(sales.rows).toHaveLength(240);
    expect(sales.rejected).toEqual([]);
    expect(skus.rows).toHaveLength(15);
    expect(skus.rows.filter((s) => s.perishability === "High").map((s) => s.skuId)).toEqual(["SKU004", "SKU007", "SKU011"]);
  });

  it("stops on a changed header instead of guessing", () => {
    expect(() => parseWeeklySales("SKU,Week,Qty\nSKU001,2026-W27,5\n")).toThrow(/missing column\(s\) SKU_ID, Units_Sold/);
  });

  it("rejects bad rows with a line number and keeps the good ones", () => {
    const text = [
      "SKU_ID,Week,Units_Sold",
      "SKU001,2026-W27,10",
      "SKU001,2026-W27,11", // duplicate
      "SKU002,2026-W28,-4", // negative
      "SKU003,W28,5", // bad week
      "SKU004,2026-W28,", // blank
      "SKU005,2026-W28,0", // zero is a valid sale count
    ].join("\n");
    const r = parseWeeklySales(text);
    expect(r.rows.map((x) => x.skuId)).toEqual(["SKU001", "SKU005"]);
    expect(r.rejected.map((x) => x.line)).toEqual([3, 4, 5, 6]);
    expect(r.rejected[1].reason).toMatch(/negative/);
  });

  it("rejects unknown perishability and zero reorder qty", () => {
    const r = parseSkus(
      "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID\n" +
        "SKU001,A,Snack,Medium,100,Units,DIST001\nSKU002,B,Snack,Low,0,Units,DIST001\n",
    );
    expect(r.rows).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'Perishability "Medium" must be Low or High',
      "Standard_Reorder_Qty is 0",
    ]);
  });

  it("reads the optional Launch_Date column", () => {
    const r = parseSkus(fs.readFileSync("seed-data/demo/sku_master.csv", "utf8"));
    expect(r.rows.map((s) => s.launchDate)).toEqual(["2026-09-07", null, null]);
  });

  it("validates inventory dates and calendar flags", () => {
    expect(parseInventory("SKU_ID,Location,Units_On_Hand,As_Of_Date\nSKU001,Pune,5,2026-02-30\n").rejected[0].reason).toMatch(
      /Invalid date/,
    );
    expect(parseCalendar("Year_Month,Is_Festival_Month\n2026-10,yes\n").rejected[0].reason).toMatch(/TRUE or FALSE/);
  });

  it("drops rows for SKUs that are not in the master", () => {
    const r = keepKnown(
      parseWeeklySales("SKU_ID,Week,Units_Sold\nSKU001,2026-W27,1\nSKU999,2026-W27,1\n"),
      "weekly_sales.csv",
      new Set(["SKU001"]),
      (x) => x.skuId,
      "SKU_ID",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rejected[0].reason).toBe("SKU_ID SKU999 is not in the master");
  });
});
