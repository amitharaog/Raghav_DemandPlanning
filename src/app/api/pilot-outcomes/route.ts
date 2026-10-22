// POST /api/pilot-outcomes - finance records actual stockout and write-off losses for a period.
import { handle } from "@/lib/api";
import { userFrom } from "@/lib/auth";
import { addPilotOutcome } from "@/lib/queries";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json();
    await addPilotOutcome(
      { periodLabel: String(b.periodLabel ?? ""), stockoutLossLakh: Number(b.stockoutLossLakh), writeoffLossLakh: Number(b.writeoffLossLakh) },
      userFrom(req.headers),
    );
    return { ok: true };
  });
}
