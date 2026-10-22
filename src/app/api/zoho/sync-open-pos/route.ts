// POST /api/zoho/sync-open-pos - pull issued, not-yet-received POs from Zoho into "stock on order".
import { handle } from "@/lib/api";
import { syncOpenPosFromZoho } from "@/lib/queries";
import { resolveRunDate } from "@/lib/run";

export const maxDuration = 60;

export async function POST() {
  return handle(() => syncOpenPosFromZoho(resolveRunDate()));
}
