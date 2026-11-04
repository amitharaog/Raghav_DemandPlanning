import { redirect } from "next/navigation";
import { getLatestCompletedRunId } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LatestReview({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const id = await getLatestCompletedRunId();
  redirect(id ? `/runs/${id}${q ? `?q=${encodeURIComponent(q)}` : ""}` : "/");
}
