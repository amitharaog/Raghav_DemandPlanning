// POST /api/runs/:id/zoho - purchase orders for approved items.
// Body {channel: "zoho"} creates draft POs in Zoho Inventory; default "csv" stores a CSV.
import { handle, idParam } from "@/lib/api";
import { userFrom } from "@/lib/auth";
import { exportToZoho } from "@/lib/queries";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    const r = await exportToZoho(idParam(id), userFrom(req.headers), body.channel === "zoho" ? "zoho" : "csv");
    return { exportId: r.exportId, poCount: r.poCount, lineCount: r.lineCount, channel: r.channel, results: r.results };
  });
}
