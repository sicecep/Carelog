// Calendar-day helpers shared by server pages. Days are YYYY-MM-DD strings in
// the workspace timezone, the API's wire format for ?date=.

/** YYYY-MM-DD for `now` rendered in the given IANA timezone. */
export function dayInTimezone(now: Date, timezone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the wire format — and
    // Intl does the zone conversion correctly, unlike hand-rolled offset math.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Shift a YYYY-MM-DD string by whole days without local-timezone drift. */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
