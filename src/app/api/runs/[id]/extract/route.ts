// GET /api/runs/:id/extract - the run's Excel extract.
import { getExtract } from "@/lib/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const extract = await getExtract(Number(id));
  if (!extract) return new Response("No extract for this run", { status: 404 });
  return new Response(new Uint8Array(extract.xlsx), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="freshroots-extract-${extract.runDate}-run${id}.xlsx"`,
    },
  });
}
