// GET /api/zoho/connect - sends the user to Zoho to approve access (one time).
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, normaliseAccountsServer, zohoConfigured } from "@/lib/zohoApi";

export async function GET(req: Request) {
  if (!zohoConfigured()) return NextResponse.redirect(new URL("/?zoho=not-configured", req.url));
  const url = new URL(req.url);
  const state = crypto.randomBytes(16).toString("hex");
  const accounts = normaliseAccountsServer(url.searchParams.get("dc") ? `https://accounts.zoho.${url.searchParams.get("dc")}` : undefined);
  const res = NextResponse.redirect(authorizeUrl(`${url.origin}/api/zoho/callback`, state, accounts));
  res.cookies.set("zoho_state", state, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
