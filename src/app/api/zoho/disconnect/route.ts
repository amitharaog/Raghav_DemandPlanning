// POST /api/zoho/disconnect - forget the saved Zoho sign-in. POs fall back to CSV.
import { handle } from "@/lib/api";
import { disconnectZoho } from "@/lib/zohoApi";

export async function POST() {
  return handle(async () => {
    await disconnectZoho();
    return { ok: true };
  });
}
