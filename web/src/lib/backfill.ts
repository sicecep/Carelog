// Backfill time presets (LOG-003 Mode 2).
//
// The PRD is explicit: "No time-picker wheel — tap chips only", and backfill is
// "Restricted to current calendar day only". So we generate discrete options and
// filter out anything in the future — a caregiver at 09:00 must not be able to
// backdate an entry to 16:00.

export interface BackfillOption {
  /** Stable key used for i18n lookup and React keys. */
  key: string;
  /** Concrete timestamp this option resolves to. */
  date: Date;
  /** "block" renders as a wide named chip (Pagi/Siang/Sore), "slot" as a time. */
  kind: "block" | "slot";
  /** For slots: the "HH:MM" label rendered on the chip. */
  label?: string;
}

/** Broad blocks from the PRD: Pagi 08:00, Siang 12:00, Sore 16:00. */
const BLOCKS: { key: string; hour: number }[] = [
  { key: "morning", hour: 8 },
  { key: "midday", hour: 12 },
  { key: "afternoon", hour: 16 },
];

function atTime(base: Date, hours: number, minutes: number): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Builds the backfill choices for `now`, newest first.
 *
 * - `slots`: 30-minute steps going back from the last half-hour boundary,
 *   capped at `maxSlots` so the sheet stays tappable on a 360px phone.
 * - `blocks`: named parts of the day, filtered to those already past.
 *
 * Everything is clamped to today (never crosses midnight backwards) and never
 * returns a future time.
 */
export function buildBackfillOptions(now: Date = new Date(), maxSlots = 8): {
  slots: BackfillOption[];
  blocks: BackfillOption[];
} {
  const midnight = atTime(now, 0, 0);

  // Round DOWN to the previous 30-minute boundary. Rounding up would produce a
  // future timestamp, which the "current day only" rule forbids.
  const flooredMinutes = now.getMinutes() < 30 ? 0 : 30;
  const cursor = atTime(now, now.getHours(), flooredMinutes);

  const slots: BackfillOption[] = [];
  for (let i = 0; i < maxSlots; i++) {
    const d = new Date(cursor.getTime() - i * 30 * 60 * 1000);
    if (d < midnight) break; // don't spill into yesterday
    slots.push({
      key: `slot-${d.getHours()}-${d.getMinutes()}`,
      date: d,
      kind: "slot",
      label: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    });
  }

  const blocks: BackfillOption[] = BLOCKS.map(({ key, hour }) => ({
    key,
    date: atTime(now, hour, 0),
    kind: "block" as const,
  })).filter((b) => b.date <= now);

  return { slots, blocks };
}
