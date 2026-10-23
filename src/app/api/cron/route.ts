// GET /api/cron - called by Vercel Cron at 00:30 UTC Mon & Thu = 06:00 IST (see vercel.json).
// Vercel sends "Authorization: Bearer <CRON_SECRET>". For a manual trigger from a
// tool that can't set headers, ?secret=<CRON_SECRET> is accepted too.
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { executeRun } from "@/lib/run";

export const maxDuration = 60;

function matches(given: string | null, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  const query = new URL(req.url).searchParams.get("secret");
  if (!secret || !(matches(bearer, secret) || matches(query, secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const out = await executeRun({ trigger: bearer ? "schedule" : "manual", triggeredBy: bearer ? "scheduler" : "manual trigger" });
  return NextResponse.json(out, { status: out.status === "failed" ? 500 : 200 });
}
