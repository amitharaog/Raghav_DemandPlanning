// GET /api/zoho/callback - Zoho redirects here with a one-time code after approval.
import { NextResponse } from "next/server";
import { userFrom } from "@/lib/auth";
import { completeConnection } from "@/lib/zohoApi";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (status: string, msg?: string) => {
    const to = new URL("/", req.url);
    to.searchParams.set("zoho", status);
    if (msg) to.searchParams.set("zoho_msg", msg.slice(0, 200));
    const res = NextResponse.redirect(to);
    res.cookies.delete("zoho_state");
    return res;
  };
  if (url.searchParams.get("error")) return back("error", url.searchParams.get("error")!);
  const state = url.searchParams.get("state");
  const expected = req.headers.get("cookie")?.match(/(?:^|;\s*)zoho_state=([^;]+)/)?.[1];
  if (!state || state !== expected) return back("error", "The sign-in link expired. Press Connect Zoho again.");
  const code = url.searchParams.get("code");
  if (!code) return back("error", "Zoho did not send a code.");
  try {
    await completeConnection({
      code,
      accountsServer: url.searchParams.get("accounts-server") ?? "",
      redirectUri: `${url.origin}/api/zoho/callback`,
      connectedBy: userFrom(req.headers),
    });
    return back("connected");
  } catch (err) {
    return back("error", (err as Error).message);
  }
}
