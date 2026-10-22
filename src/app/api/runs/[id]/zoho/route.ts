// POST /api/runs/:id/zoho - build POs for approved items and hand them to Zoho (CSV in the pilot).
import { handle, idParam } from "@/lib/api";
import { userFrom } from "@/lib/auth";
import { exportToZoho } from "@/lib/queries";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const r = await exportToZoho(idParam(id), userFrom(req.headers));
    return { exportId: r.exportId, poCount: r.poCount, lineCount: r.lineCount, channel: r.channel };
  });
}
