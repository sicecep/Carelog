// "Tampilan" (appearance) preference, per device.
//
// Stored in a cookie rather than localStorage so the server can render the
// right theme on the first paint: the [locale] layout reads it and puts the
// `.light` class on <html>, which globals.css uses to opt out of the dark
// tokens. No flash of dark-then-light on load. Not account data, so it never
// reaches the API.

export const APPEARANCE_COOKIE = "cl_appearance";

/** "system" follows the phone (default); "light" always stays light. */
export type Appearance = "system" | "light";

// A year; the choice is a device preference, not a session.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseAppearance(value: string | undefined): Appearance {
  return value === "light" ? "light" : "system";
}

/** Client only: persist the choice and apply it to the open page at once. */
export function applyAppearance(appearance: Appearance): void {
  if (appearance === "light") {
    document.cookie = `${APPEARANCE_COOKIE}=light; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
  } else {
    document.cookie = `${APPEARANCE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
  document.documentElement.classList.toggle("light", appearance === "light");
}
