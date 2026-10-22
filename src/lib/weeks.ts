// ISO-week helpers. All dates are YYYY-MM-DD strings in UTC.

export function isoWeekToMonday(isoWeek: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek.trim());
  if (!m) throw new Error(`Not an ISO week: "${isoWeek}" (expected e.g. 2026-W27)`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) throw new Error(`Week out of range: "${isoWeek}"`);
  // Jan 4th is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (week - 1) * 7);
  if (week === 53 && mondayToIsoWeek(toDateString(monday)) !== isoWeek) {
    throw new Error(`${year} has no week 53`);
  }
  return toDateString(monday);
}

export function mondayToIsoWeek(date: string): string {
  const d = parseDate(date);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow); // Thursday decides the ISO year
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function parseDate(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) throw new Error(`Not a date: "${date}" (expected YYYY-MM-DD)`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (toDateString(d) !== date.trim()) throw new Error(`Invalid date: "${date}"`);
  return d;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86400000);
}

/** Today's date in India, which is what "run date" means for Raghav. */
export function todayIST(now: Date = new Date()): string {
  return toDateString(new Date(now.getTime() + 5.5 * 3600 * 1000));
}
