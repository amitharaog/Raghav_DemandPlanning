// POST /api/zoho/connect-code - Self Client route: paste a grant code from the Zoho API Console.
import { handle } from "@/lib/api";
import { userFrom } from "@/lib/auth";
import { UserError } from "@/lib/queries";
import { completeConnection } from "@/lib/zohoApi";

export async function POST(req: Request) {
  return handle(async () => {
    const b = await req.json().catch(() => ({}));
    if (!b.code) throw new UserError("Paste the code generated in the Zoho API Console.");
    try {
      const c = await completeConnection({ code: String(b.code), accountsServer: String(b.accountsServer ?? ""), connectedBy: userFrom(req.headers) });
      return { ok: true, organizationName: c.organizationName };
    } catch (err) {
      throw new UserError((err as Error).message);
    }
  });
}
