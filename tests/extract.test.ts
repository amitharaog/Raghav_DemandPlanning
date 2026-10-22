import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildExtract } from "@/lib/extract";
import { flat, snapshot } from "./fixtures";

describe("Excel extract", () => {
  it("has one sheet per input, with sales by SKU by week", async () => {
    const sales: (number | null)[] = flat(10, 4);
    sales[1] = null;
    const snap = snapshot([{ sales, stock: 50, onOrder: 20 }, { sales: flat(5, 4), stock: 30 }]);
    const wb = new ExcelJS.Workbook();
    const xlsx = await buildExtract(snap, ["a note"]);
    await wb.xlsx.load(xlsx as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Run info", "Sales by week", "Current stock", "Open POs", "SKU attributes"]);
    const salesWs = wb.getWorksheet("Sales by week")!;
    expect(salesWs.getRow(1).values).toEqual([undefined, "SKU_ID", "SKU_Name", "2026-W39", "2026-W40", "2026-W41", "2026-W42"]);
    expect(salesWs.getRow(2).getCell(3).value).toBe(10);
    expect(salesWs.getRow(2).getCell(4).value).toBeNull(); // missing week stays blank, not 0
    const stock = wb.getWorksheet("Current stock")!;
    expect(stock.getRow(2).getCell(7).value).toBe(70); // in hand + on order
    expect(wb.getWorksheet("SKU attributes")!.getRow(2).getCell(10).value).toMatch(/First week in SAP export/);
  });
});
