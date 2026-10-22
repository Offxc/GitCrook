const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/**
 * "3 days ago" for the published page's last-updated line, via Intl rather
 * than a date library — this is the only relative-time formatting in the
 * app, and it's rendered server-side, so the bundle cost of a dependency
 * would buy nothing.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let duration = (date.getTime() - now.getTime()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatter.format(Math.round(duration), "year");
}
