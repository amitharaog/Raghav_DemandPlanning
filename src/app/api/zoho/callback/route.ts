// GET /api/zoho/callback - Zoho redirects here with a one-time code after approval.
import { NextResponse } from "next/server";
import { userFrom } from "@/lib/auth";
import { checkState, completeConnection } from "@/lib/zohoApi";

const STATE_MESSAGE = {
  missing: "Zoho did not return the sign-in check. Press Connect Zoho again.",
  "bad-signature": "The sign-in check did not match. Press Connect Zoho again from this site.",
  expired: "The sign-in took longer than 30 minutes. Press Connect Zoho again.",
} as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;
  const back = (status: string, msg?: string) => {
    const to = new URL("/", req.url);
    to.searchParams.set("zoho", status);
    if (msg) to.searchParams.set("zoho_msg", msg.slice(0, 200));
    return NextResponse.redirect(to);
  };
  const state = checkState(p.get("state"));
  // Diagnostics only: which parameters arrived, never their values.
  console.log("zoho callback", {
    state,
    hasCode: p.has("code"),
    error: p.get("error"),
    location: p.get("location"),
    accountsServer: p.get("accounts-server"),
  });
  if (p.get("error")) return back("error", `Zoho said: ${p.get("error")}`);
  if (state !== "ok") return back("error", STATE_MESSAGE[state]);
  const code = p.get("code");
  if (!code) return back("error", "Zoho did not send a code.");
  try {
    await completeConnection({
      code,
      accountsServer: p.get("accounts-server") ?? "",
      redirectUri: `${url.origin}/api/zoho/callback`,
      connectedBy: userFrom(req.headers),
    });
    return back("connected");
  } catch (err) {
    console.error("zoho connect failed", (err as Error).message);
    return back("error", (err as Error).message);
  }
}
