import { redirect } from "next/navigation";
import { getLatestCompletedRunId } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LatestTrends() {
  const id = await getLatestCompletedRunId();
  redirect(id ? `/runs/${id}/trends` : "/");
}
