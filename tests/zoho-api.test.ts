import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupByPo, buildPurchaseOrderLines, type ApprovedLine } from "@/lib/zoho";
import { createDraftPurchaseOrder, decrypt, encrypt, openPoLines, authorizeUrl, normaliseAccountsServer } from "@/lib/zohoApi";

beforeEach(() => {
  process.env.ZOHO_CLIENT_ID = "1000.TESTCLIENT";
  process.env.ZOHO_CLIENT_SECRET = "test-secret";
});
afterEach(() => vi.unstubAllGlobals());

const approved = (o: Partial<ApprovedLine>): ApprovedLine => ({
  skuId: "SKU001", skuName: "Freshroots Mango Drink 200ml", unitOfMeasure: "Units", distributorId: "DIST001",
  distributorName: "NutriFlow Distributors", quantity: 750, decision: "APPROVE", decisionReason: null, ...o,
});

describe("Zoho OAuth helpers", () => {
  it("encrypts the refresh token so the database never holds it in clear", () => {
    const enc = encrypt("1000.refresh.token");
    expect(enc).not.toContain("refresh");
    expect(decrypt(enc)).toBe("1000.refresh.token");
    process.env.ZOHO_CLIENT_SECRET = "rotated";
    expect(() => decrypt(enc)).toThrow();
  });
  it("asks for offline access with the needed scopes", () => {
    const u = new URL(authorizeUrl("https://app.example/api/zoho/callback", "st", "https://accounts.zoho.in"));
    expect(u.origin).toBe("https://accounts.zoho.in");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("scope")).toContain("ZohoInventory.purchaseorders.CREATE");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example/api/zoho/callback");
  });
  it("only accepts real Zoho accounts servers", () => {
    expect(normaliseAccountsServer("https://accounts.zoho.eu/")).toBe("https://accounts.zoho.eu");
    expect(() => normaliseAccountsServer("https://evil.example")).toThrow();
  });
});

describe("draft purchase orders", () => {
  it("groups approved lines into one PO per vendor", () => {
    const lines = buildPurchaseOrderLines(3, "2026-10-22", [
      approved({}),
      approved({ skuId: "SKU013", quantity: 120, decision: "CHANGE_QTY", decisionReason: "festival top-up" }),
      approved({ skuId: "SKU003", distributorId: "DIST002", distributorName: "GrainPath Logistics", quantity: 300 }),
    ]);
    const pos = groupByPo(lines);
    expect(pos.map((p) => [p.poNumber, p.vendorName, p.lines])).toEqual([
      ["FR-20261022-R3-DIST001", "NutriFlow Distributors", [{ sku: "SKU001", quantity: 750 }, { sku: "SKU013", quantity: 120 }]],
      ["FR-20261022-R3-DIST002", "GrainPath Logistics", [{ sku: "SKU003", quantity: 300 }]],
    ]);
    expect(pos[0].notes).toMatch(/SKU013: Qty changed by Raghav: festival top-up/);
  });

  it("looks up the vendor and items, then creates the PO with Zoho's IDs", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const u = new URL(url);
      const body = u.pathname.endsWith("/contacts")
        ? { code: 0, contacts: [{ contact_id: "V1", contact_name: "nutriflow distributors" }] }
        : u.pathname.endsWith("/items")
          ? { code: 0, items: [{ item_id: `I-${u.searchParams.get("search_text")}`, sku: u.searchParams.get("search_text") }] }
          : { code: 0, purchaseorder: { purchaseorder_id: "PO9", purchaseorder_number: "PO-00009" } };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const s = { apiDomain: "https://www.zohoapis.in", accessToken: "tok", organizationId: "ORG1" };
    const r = await createDraftPurchaseOrder(s, {
      poNumber: "FR-20261022-R3-DIST001", vendorName: "NutriFlow Distributors", date: "2026-10-22", reference: "Demand run #3",
      notes: "n", lines: [{ sku: "SKU001", quantity: 750 }, { sku: "SKU013", quantity: 120 }],
    });
    expect(r).toEqual({ id: "PO9", number: "PO-00009" });
    const create = calls[calls.length - 1];
    expect(create.url).toBe("https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=ORG1");
    expect((create.init!.headers as Record<string, string>).authorization).toBe("Zoho-oauthtoken tok");
    expect(JSON.parse(create.init!.body as string)).toEqual({
      vendor_id: "V1", reference_number: "FR-20261022-R3-DIST001 | Demand run #3", date: "2026-10-22", notes: "n",
      line_items: [{ item_id: "I-SKU001", quantity: 750 }, { item_id: "I-SKU013", quantity: 120 }],
    });
  });

  it("refuses to create a PO for a vendor Zoho doesn't know", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 0, contacts: [] }))));
    const s = { apiDomain: "https://www.zohoapis.in", accessToken: "tok", organizationId: "ORG1" };
    await expect(
      createDraftPurchaseOrder(s, { poNumber: "X", vendorName: "Unknown Co", date: "2026-10-22", reference: "r", notes: "", lines: [] }),
    ).rejects.toThrow(/Vendor "Unknown Co" is not in Zoho Inventory/);
  });

  it("surfaces Zoho's own error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 57, message: "You are not authorized" }), { status: 401 })));
    const s = { apiDomain: "https://www.zohoapis.in", accessToken: "tok", organizationId: "ORG1" };
    await expect(
      createDraftPurchaseOrder(s, { poNumber: "X", vendorName: "A", date: "2026-10-22", reference: "r", notes: "", lines: [] }),
    ).rejects.toThrow(/You are not authorized \(code 57\)/);
  });
});

describe("open purchase orders -> stock on order", () => {
  it("counts ordered minus received, only for issued POs", () => {
    const lines = openPoLines([
      { purchaseorder_id: "1", purchaseorder_number: "PO-1", status: "open", delivery_date: "2026-10-28",
        line_items: [{ sku: "SKU004", quantity: 300, quantity_received: 0 }, { sku: "SKU011", quantity: "500", quantity_received: "500" }] },
      { purchaseorder_id: "2", purchaseorder_number: "PO-2", status: "partially_received", line_items: [{ sku: "SKU004", quantity: 200, quantity_received: 50 }] },
      { purchaseorder_id: "3", purchaseorder_number: "PO-3", status: "draft", line_items: [{ sku: "SKU001", quantity: 750 }] },
      { purchaseorder_id: "4", purchaseorder_number: "PO-4", status: "billed", line_items: [{ sku: "SKU001", quantity: 750 }] },
    ]);
    expect(lines).toEqual([
      { poNumber: "PO-1", sku: "SKU004", qtyOnOrder: 300, expectedDate: "2026-10-28" },
      { poNumber: "PO-2", sku: "SKU004", qtyOnOrder: 150, expectedDate: null },
    ]);
  });
});

describe("OAuth state (no cookie needed)", () => {
  it("accepts its own fresh state and rejects tampered, missing or old ones", async () => {
    const { makeState, checkState } = await import("@/lib/zohoApi");
    const now = 1_800_000_000_000;
    const s = makeState(now);
    expect(checkState(s, now + 5 * 60_000)).toBe("ok");
    expect(checkState(s, now + 31 * 60_000)).toBe("expired");
    expect(checkState(s.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now)).toBe("bad-signature");
    expect(checkState(null, now)).toBe("missing");
    process.env.ZOHO_CLIENT_SECRET = "someone-else";
    expect(checkState(s, now)).toBe("bad-signature");
  });
});
