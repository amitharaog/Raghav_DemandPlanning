// Zoho Inventory API: OAuth, vendor/item lookup, purchase order create, open-PO read.
// Credentials: ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET (Vercel env). The refresh
// token from the one-time "Connect Zoho" consent is stored encrypted in the DB.

import crypto from "node:crypto";
import { getPool } from "./db";

export const ZOHO_SCOPES = [
  "ZohoInventory.purchaseorders.CREATE",
  "ZohoInventory.purchaseorders.READ",
  "ZohoInventory.contacts.READ",
  "ZohoInventory.items.READ",
  "ZohoInventory.settings.READ",
].join(",");

export const DEFAULT_ACCOUNTS_SERVER = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in";

export class ZohoError extends Error {}

export function zohoConfigured(): boolean {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}

function credentials() {
  const id = process.env.ZOHO_CLIENT_ID;
  const secret = process.env.ZOHO_CLIENT_SECRET;
  if (!id || !secret) throw new ZohoError("ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET are not set.");
  return { id, secret };
}

// --- token storage -----------------------------------------------------------

function key(): Buffer {
  return crypto.createHash("sha256").update(`freshroots-zoho:${credentials().secret}`).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function decrypt(enc: string): string {
  const [iv, tag, body] = enc.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

export type ZohoConnection = {
  accountsServer: string;
  apiDomain: string;
  organizationId: string;
  organizationName: string;
  connectedBy: string;
  connectedAt: string;
};

export async function getZohoConnection(): Promise<(ZohoConnection & { refreshTokenEnc: string }) | null> {
  const { rows } = await getPool().query(`select * from zoho_connection where id = 1`);
  const r = rows[0];
  if (!r) return null;
  return {
    accountsServer: r.accounts_server,
    apiDomain: r.api_domain,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    connectedBy: r.connected_by,
    connectedAt: new Date(r.connected_at).toISOString(),
    refreshTokenEnc: r.refresh_token_enc,
  };
}

export async function disconnectZoho(): Promise<void> {
  await getPool().query(`delete from zoho_connection where id = 1`);
  tokenCache = null;
}

// --- OAuth ---------------------------------------------------------------------

const STATE_MAX_AGE_MS = 30 * 60 * 1000;

/** A signed, self-checking OAuth state: no cookie needed to verify it on the way back. */
export function makeState(now = Date.now()): string {
  const ts = String(now);
  const sig = crypto.createHmac("sha256", key()).update(`zoho-state:${ts}`).digest("base64url");
  return `${ts}.${sig}`;
}

export function checkState(state: string | null, now = Date.now()): "ok" | "missing" | "bad-signature" | "expired" {
  if (!state) return "missing";
  const [ts, sig] = state.split(".");
  if (!ts || !sig) return "bad-signature";
  const expected = crypto.createHmac("sha256", key()).update(`zoho-state:${ts}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "bad-signature";
  return now - Number(ts) > STATE_MAX_AGE_MS || Number(ts) > now + 60_000 ? "expired" : "ok";
}

export function authorizeUrl(redirectUri: string, state: string, accountsServer = DEFAULT_ACCOUNTS_SERVER): string {
  const p = new URLSearchParams({
    scope: ZOHO_SCOPES,
    client_id: credentials().id,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    redirect_uri: redirectUri,
    state,
  });
  return `${accountsServer}/oauth/v2/auth?${p}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; api_domain?: string; expires_in?: number; error?: string };

async function tokenRequest(accountsServer: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  // Zoho reports OAuth errors with HTTP 200 and an "error" field.
  if (!res.ok || json.error || !json.access_token) {
    throw new ZohoError(`Zoho sign-in failed: ${json.error ?? res.statusText}`);
  }
  return json;
}

/** Exchanges a consent code (from the redirect, or a Self Client code) and saves the connection. */
export async function completeConnection(opts: {
  code: string;
  accountsServer: string;
  redirectUri?: string;
  connectedBy: string;
}): Promise<ZohoConnection> {
  const { id, secret } = credentials();
  const accountsServer = normaliseAccountsServer(opts.accountsServer);
  const params: Record<string, string> = { grant_type: "authorization_code", client_id: id, client_secret: secret, code: opts.code.trim() };
  if (opts.redirectUri) params.redirect_uri = opts.redirectUri;
  const t = await tokenRequest(accountsServer, params);
  if (!t.refresh_token) throw new ZohoError("Zoho did not return a refresh token. Remove the app's access in Zoho and connect again.");
  const apiDomain = t.api_domain || accountsServer.replace("accounts.zoho", "www.zohoapis");

  let organizationId = process.env.ZOHO_ORG_ID ?? "";
  let organizationName = organizationId ? `Organization ${organizationId}` : "";
  if (!organizationId) {
    const orgs = await zohoGet<{ organizations?: { organization_id: string; name: string }[] }>(
      { apiDomain, accessToken: t.access_token! },
      "/organizations",
    );
    const org = orgs.organizations?.[0];
    if (!org) throw new ZohoError("This Zoho account has no Zoho Inventory organization.");
    organizationId = org.organization_id;
    organizationName = org.name;
  }

  await getPool().query(
    `insert into zoho_connection (id, accounts_server, api_domain, refresh_token_enc, organization_id, organization_name, connected_by)
     values (1, $1, $2, $3, $4, $5, $6)
     on conflict (id) do update set accounts_server = excluded.accounts_server, api_domain = excluded.api_domain,
       refresh_token_enc = excluded.refresh_token_enc, organization_id = excluded.organization_id,
       organization_name = excluded.organization_name, connected_by = excluded.connected_by, connected_at = now()`,
    [accountsServer, apiDomain, encrypt(t.refresh_token), organizationId, organizationName, opts.connectedBy],
  );
  tokenCache = { token: t.access_token!, expiresAt: Date.now() + ((t.expires_in ?? 3600) - 120) * 1000 };
  return { accountsServer, apiDomain, organizationId, organizationName, connectedBy: opts.connectedBy, connectedAt: new Date().toISOString() };
}

export function normaliseAccountsServer(s: string | null | undefined): string {
  const v = (s || DEFAULT_ACCOUNTS_SERVER).trim().replace(/\/+$/, "");
  if (!/^https:\/\/accounts\.zoho\.[a-z.]+$/.test(v)) throw new ZohoError(`Unexpected Zoho accounts server "${v}".`);
  return v;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

type Session = { apiDomain: string; accessToken: string; organizationId?: string };

export async function zohoSession(): Promise<Session & { organizationId: string; organizationName: string }> {
  const conn = await getZohoConnection();
  if (!conn) throw new ZohoError("Zoho is not connected yet.");
  if (!tokenCache || tokenCache.expiresAt < Date.now()) {
    const { id, secret } = credentials();
    let refresh: string;
    try {
      refresh = decrypt(conn.refreshTokenEnc);
    } catch {
      throw new ZohoError("The saved Zoho sign-in can't be read (the client secret changed). Connect Zoho again.");
    }
    const t = await tokenRequest(conn.accountsServer, { grant_type: "refresh_token", client_id: id, client_secret: secret, refresh_token: refresh });
    tokenCache = { token: t.access_token!, expiresAt: Date.now() + ((t.expires_in ?? 3600) - 120) * 1000 };
  }
  return { apiDomain: conn.apiDomain, accessToken: tokenCache.token, organizationId: conn.organizationId, organizationName: conn.organizationName };
}

// --- API calls -----------------------------------------------------------------

type ZohoReply = { code?: number; message?: string };

async function zohoCall<T>(s: Session, method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const q = new URLSearchParams(query);
  if (s.organizationId) q.set("organization_id", s.organizationId);
  const res = await fetch(`${s.apiDomain}/inventory/v1${path}${q.size ? `?${q}` : ""}`, {
    method,
    headers: {
      authorization: `Zoho-oauthtoken ${s.accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & ZohoReply;
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new ZohoError(`Zoho ${method} ${path} failed: ${json.message ?? res.statusText} (code ${json.code ?? res.status})`);
  }
  return json;
}

export const zohoGet = <T>(s: Session, path: string, query: Record<string, string> = {}) => zohoCall<T>(s, "GET", path, query);
export const zohoPost = <T>(s: Session, path: string, body: unknown, query: Record<string, string> = {}) =>
  zohoCall<T>(s, "POST", path, query, body);

const same = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

export async function findVendorId(s: Session, vendorName: string): Promise<string | null> {
  const r = await zohoGet<{ contacts?: { contact_id: string; contact_name?: string; company_name?: string; vendor_name?: string }[] }>(
    s,
    "/contacts",
    { contact_type: "vendor", search_text: vendorName },
  );
  const hit = (r.contacts ?? []).find((c) => same(c.contact_name, vendorName) || same(c.company_name, vendorName) || same(c.vendor_name, vendorName));
  return hit?.contact_id ?? null;
}

export async function findItemId(s: Session, sku: string): Promise<string | null> {
  const r = await zohoGet<{ items?: { item_id: string; sku?: string }[] }>(s, "/items", { search_text: sku });
  return (r.items ?? []).find((i) => same(i.sku, sku))?.item_id ?? null;
}

export type DraftPo = {
  poNumber: string;
  vendorName: string;
  date: string;
  reference: string;
  notes: string;
  lines: { sku: string; quantity: number }[];
};

export async function createDraftPurchaseOrder(s: Session, po: DraftPo): Promise<{ id: string; number: string }> {
  const vendorId = await findVendorId(s, po.vendorName);
  if (!vendorId) throw new ZohoError(`Vendor "${po.vendorName}" is not in Zoho Inventory. Add it, or rename it to match.`);
  const lineItems = [];
  for (const l of po.lines) {
    const itemId = await findItemId(s, l.sku);
    if (!itemId) throw new ZohoError(`Item with SKU ${l.sku} is not in Zoho Inventory.`);
    lineItems.push({ item_id: itemId, quantity: l.quantity });
  }
  const r = await zohoPost<{ purchaseorder?: { purchaseorder_id: string; purchaseorder_number: string } }>(s, "/purchaseorders", {
    vendor_id: vendorId,
    reference_number: `${po.poNumber} | ${po.reference}`.slice(0, 50),
    date: po.date,
    notes: po.notes,
    line_items: lineItems,
  });
  if (!r.purchaseorder) throw new ZohoError("Zoho accepted the request but returned no purchase order.");
  return { id: r.purchaseorder.purchaseorder_id, number: r.purchaseorder.purchaseorder_number };
}

// --- open purchase orders -> stock on order --------------------------------------

/** Statuses that mean "ordered, not fully received". Drafts are not on order yet. */
const ON_ORDER_STATUSES = new Set(["open", "issued", "partially_received", "partially received"]);

export type OpenPoLine = { poNumber: string; sku: string; qtyOnOrder: number; expectedDate: string | null };

type ZohoPoLine = { sku?: string; quantity?: number | string; quantity_received?: number | string };
type ZohoPo = { purchaseorder_id: string; purchaseorder_number: string; status?: string; delivery_date?: string; line_items?: ZohoPoLine[] };

/** Pure: turns Zoho purchase orders (with line items) into on-order quantities. */
export function openPoLines(pos: ZohoPo[]): OpenPoLine[] {
  const out: OpenPoLine[] = [];
  for (const po of pos) {
    if (!ON_ORDER_STATUSES.has((po.status ?? "").toLowerCase())) continue;
    for (const l of po.line_items ?? []) {
      const left = Number(l.quantity ?? 0) - Number(l.quantity_received ?? 0);
      if (l.sku && left > 0) {
        out.push({ poNumber: po.purchaseorder_number, sku: l.sku, qtyOnOrder: Math.round(left), expectedDate: po.delivery_date || null });
      }
    }
  }
  return out;
}

export async function fetchOpenPurchaseOrders(s: Session): Promise<OpenPoLine[]> {
  const full: ZohoPo[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await zohoGet<{ purchaseorders?: ZohoPo[]; page_context?: { has_more_page?: boolean } }>(s, "/purchaseorders", {
      page: String(page),
      per_page: "200",
    });
    for (const po of r.purchaseorders ?? []) {
      if (!ON_ORDER_STATUSES.has((po.status ?? "").toLowerCase())) continue;
      const d = await zohoGet<{ purchaseorder?: ZohoPo }>(s, `/purchaseorders/${po.purchaseorder_id}`);
      if (d.purchaseorder) full.push({ ...d.purchaseorder, status: d.purchaseorder.status ?? po.status });
    }
    if (!r.page_context?.has_more_page) break;
  }
  return openPoLines(full);
}
