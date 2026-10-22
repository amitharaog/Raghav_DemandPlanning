// POST /api/recommendations/:id/reason-feedback - Raghav flags a reason as wrong (AI kill criterion).
import { handle, idParam } from "@/lib/api";
import { setReasonMarkedWrong } from "@/lib/queries";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await req.json();
    await setReasonMarkedWrong(idParam(id), !!body.wrong);
    return { ok: true };
  });
}
