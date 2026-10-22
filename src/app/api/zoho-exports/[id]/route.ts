// GET /api/zoho-exports/:id - download a generated Zoho purchase order CSV.
import { getZohoExport } from "@/lib/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exp = await getZohoExport(Number(id));
  if (!exp) return new Response("Not found", { status: 404 });
  return new Response(exp.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zoho-purchase-orders-run${exp.runId}-${id}.csv"`,
    },
  });
}
