// GET /api/cron - called by Vercel Cron at 00:30 UTC Mon & Thu = 06:00 IST (see vercel.json).
import { NextResponse } from "next/server";
import { executeRun } from "@/lib/run";

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const out = await executeRun({ trigger: "schedule", triggeredBy: "scheduler" });
  return NextResponse.json(out, { status: out.status === "failed" ? 500 : 200 });
}
