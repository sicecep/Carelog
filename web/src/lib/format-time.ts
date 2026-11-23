/**
 * Wall-clock time (HH:mm, 24-hour) for an instant, in a given IANA zone.
 *
 * Never format with the runtime's locale or zone (`toLocaleTimeString()`,
 * `Intl.DateTimeFormat(undefined)`): the server renders in its own (English,
 * UTC in production) and the phone in Indonesian/Jakarta, so the text differs,
 * React reports a hydration error, and the server-rendered time is wrong for
 * the household. Callers pass the workspace's timezone (DEFAULT_TIMEZONE when
 * unknown) and the app locale.
 */

/** CareLog households are in Indonesia; used when the workspace is unknown. */
export const DEFAULT_TIMEZONE = "Asia/Jakarta";

export function formatClock(iso: string, locale: string, timezone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    // An unknown zone name (bad settings data) must not blank the timeline.
    return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      timeZone: DEFAULT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }
}

/**
 * Short calendar date ("23 Nov 2026") for an instant, in a
 * given IANA zone. Same rule as formatClock: explicit locale and zone, so the
 * server render and the phone agree.
 */
export function formatShortDate(iso: string, locale: string, timezone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  try {
    return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { ...opts, timeZone: timezone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { ...opts, timeZone: DEFAULT_TIMEZONE }).format(d);
  }
}
