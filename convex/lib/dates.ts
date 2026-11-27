/** Calendar-date helpers. Dates are stored as `YYYY-MM-DD` strings, never as timestamps. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayISO(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function isISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Rejects impossible dates like 2026-02-31 that Date would roll over.
  return parsed.toISOString().slice(0, 10) === value;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

export function isoDayOffset(date: string, offset: number): string {
  const base = Date.parse(`${date}T00:00:00.000Z`) + offset * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

/** Two inclusive date ranges overlap when each starts no later than the other ends. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
