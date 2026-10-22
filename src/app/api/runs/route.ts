// POST /api/runs - the "Run now" button.
import { handle } from "@/lib/api";
import { userFrom } from "@/lib/auth";
import { UserError } from "@/lib/queries";
import { executeRun } from "@/lib/run";

export const maxDuration = 300;

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    try {
      return await executeRun({ runDate: body.runDate ?? null, trigger: "manual", triggeredBy: userFrom(req.headers) });
    } catch (err) {
      throw new UserError((err as Error).message);
    }
  });
}
