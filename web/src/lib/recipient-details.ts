import { GENDERS, RECIPIENT_MEASUREMENTS, type Gender } from "@/lib/constants.generated";

/**
 * Draft state of a recipient's optional profile details, as the form holds
 * it: every field is a string so an empty input means "not provided".
 */
export interface RecipientDetailsDraft {
  gender: Gender | "";
  dateOfBirth: string; // YYYY-MM-DD or ""
  weightKg: string;
  heightCm: string;
}

/** Field -> message key (under the `recipientDetails` namespace). */
export type RecipientDetailsErrors = Partial<Record<keyof RecipientDetailsDraft, string>>;

/** The parsed details, ready for the API. null means empty. */
export interface RecipientDetailsValues {
  gender: Gender | null;
  date_of_birth: string | null;
  weight_kg: number | null;
  height_cm: number | null;
}

export const EMPTY_RECIPIENT_DETAILS: RecipientDetailsDraft = {
  gender: "",
  dateOfBirth: "",
  weightKg: "",
  heightCm: "",
};

/** The earliest birth date the API accepts (service.MinBirthYear). */
export const MIN_BIRTH_DATE = "1900-01-01";

const isGender = (v: string): v is Gender => (GENDERS as readonly string[]).includes(v);

/** Builds a draft from a saved recipient; decimals use the locale's separator. */
export function detailsDraftFrom(
  r: { gender?: string; date_of_birth?: string; weight_kg?: number; height_cm?: number },
  locale: string
): RecipientDetailsDraft {
  const num = (n?: number) => (n == null ? "" : locale === "id" ? String(n).replace(".", ",") : String(n));
  return {
    gender: r.gender && isGender(r.gender) ? r.gender : "",
    dateOfBirth: r.date_of_birth ?? "",
    weightKg: num(r.weight_kg),
    heightCm: num(r.height_cm),
  };
}

/**
 * Parses a decimal typed with either separator: Indonesian keyboards often
 * produce "52,5". Returns NaN for anything that is not a plain number.
 */
function parseDecimal(s: string): number {
  const normalised = s.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(normalised) ? Number(normalised) : NaN;
}

function parseMeasurement(
  raw: string,
  range: { min: number; max: number }
): { value: number | null; error?: string } {
  if (raw.trim() === "") return { value: null };
  const n = parseDecimal(raw);
  if (Number.isNaN(n)) return { value: null, error: "invalidNumber" };
  if (n < range.min || n > range.max) return { value: null, error: "outOfRange" };
  return { value: n };
}

/** Today's date in the browser's timezone, as YYYY-MM-DD. */
export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Validates a draft. Empty fields are always valid. */
export function parseRecipientDetails(
  draft: RecipientDetailsDraft,
  today: string = todayISO()
): { values: RecipientDetailsValues; errors: RecipientDetailsErrors } {
  const errors: RecipientDetailsErrors = {};

  const dob = draft.dateOfBirth.trim();
  if (dob !== "") {
    // Date inputs yield YYYY-MM-DD, so string comparison orders correctly.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob < MIN_BIRTH_DATE) errors.dateOfBirth = "invalidDate";
    else if (dob > today) errors.dateOfBirth = "futureDate";
  }

  const weight = parseMeasurement(draft.weightKg, RECIPIENT_MEASUREMENTS.weight_kg);
  if (weight.error) errors.weightKg = weight.error;
  const height = parseMeasurement(draft.heightCm, RECIPIENT_MEASUREMENTS.height_cm);
  if (height.error) errors.heightCm = height.error;

  return {
    values: {
      gender: draft.gender || null,
      date_of_birth: dob || null,
      weight_kg: weight.value,
      height_cm: height.value,
    },
    errors,
  };
}

export function sameDetails(a: RecipientDetailsDraft, b: RecipientDetailsDraft): boolean {
  return (
    a.gender === b.gender &&
    a.dateOfBirth.trim() === b.dateOfBirth.trim() &&
    a.weightKg.trim() === b.weightKg.trim() &&
    a.heightCm.trim() === b.heightCm.trim()
  );
}

/** Below this many months an age reads better in months ("8 bulan"). */
const AGE_IN_MONTHS_BELOW = 24;

/**
 * Age at `today` (both YYYY-MM-DD) for a profile header. Pure string math, so
 * the server render and the browser agree: pass the workspace's "today".
 * Returns null for a missing or future birth date.
 */
export function ageFrom(dateOfBirth: string | undefined, today: string): { unit: "months" | "years"; count: number } | null {
  if (!dateOfBirth) return null;
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if ([by, bm, bd, ty, tm, td].some(Number.isNaN)) return null;
  const months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) return null;
  return months < AGE_IN_MONTHS_BELOW
    ? { unit: "months", count: months }
    : { unit: "years", count: Math.floor(months / 12) };
}
