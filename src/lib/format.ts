// Display helpers shared by pages and the client table.

export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function int(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : v.toLocaleString("en-IN");
}

export function pctChange(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return "–";
  const p = (ratio - 1) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export function istDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Next Mon or Thu 06:00 IST after `now`. */
export function nextScheduledRun(now: Date = new Date()): Date {
  const istOffset = 5.5 * 3600 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + i, 6, 0));
    const dow = d.getUTCDay();
    if ((dow === 1 || dow === 4) && d.getTime() > ist.getTime()) return new Date(d.getTime() - istOffset);
  }
  throw new Error("unreachable");
}
