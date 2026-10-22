// POST /api/recommendations/:id/decision - Approve, Change qty or Hold (reason required for the last two).
import { handle, idParam } from "@/lib/api";
import { userFrom } from "@/lib/auth";
import { recordDecision } from "@/lib/queries";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await req.json();
    await recordDecision(idParam(id), { decision: body.decision, qty: body.qty, reason: body.reason }, userFrom(req.headers));
    return { ok: true };
  });
}
