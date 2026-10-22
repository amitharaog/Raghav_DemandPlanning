// POST /api/runs/:id/bulk-approve - approve every rule-based item without a decision.
import { handle, idParam } from "@/lib/api";
import { userFrom } from "@/lib/auth";
import { bulkApprove } from "@/lib/queries";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ({ approved: await bulkApprove(idParam(id), userFrom(req.headers)) }));
}
