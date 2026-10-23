// GET /api/zoho/connect - sends the user to Zoho to approve access (one time).
import { NextResponse } from "next/server";
import { authorizeUrl, makeState, normaliseAccountsServer, zohoConfigured } from "@/lib/zohoApi";

export async function GET(req: Request) {
  if (!zohoConfigured()) return NextResponse.redirect(new URL("/?zoho=not-configured", req.url));
  const url = new URL(req.url);
  const dc = url.searchParams.get("dc");
  const accounts = normaliseAccountsServer(dc ? `https://accounts.zoho.${dc}` : undefined);
  return NextResponse.redirect(authorizeUrl(`${url.origin}/api/zoho/callback`, makeState(), accounts));
}
