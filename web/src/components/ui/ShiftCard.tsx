import { getTranslations } from "next-intl/server";
import type { ShiftRow } from "@/lib/api-client";

/**
 * RPT-004: one shift card per caregiver who checked in on the viewed day.
 *
 * Rendered INLINE at the check-in timestamp on the timeline, not pinned to
 * top — the PRD is explicit about that. The idea is that an owner reading
 * the timeline sees the shift boundary in context, next to whatever the
 * caregiver logged during it.
 *
 * A card is a server component: no client state, no interactivity beyond
 * reading. Duration renders as "8j 15m" (ID) / "8h 15m" (EN), computed in
 * whichever timezone the workspace runs in — same as the timeline dates.
 */
export async function ShiftCard({
  locale,
  timezone,
  shift,
}: {
  locale: string;
  /** Workspace IANA zone, used for the check-in/out clock display. */
  timezone: string;
  shift: ShiftRow;
}) {
  const t = await getTranslations({ locale, namespace: "shifts" });

  const timeFmt = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const inLabel = timeFmt.format(new Date(shift.checked_in_at));
  const active = !shift.checked_out_at;
  const outLabel = active
    ? t("stillOnShift")
    : timeFmt.format(new Date(shift.checked_out_at!));

  // Duration is only shown for closed shifts. An open shift's "duration so
  // far" would render as stale-by-render — the number is wrong the instant
  // the server flushes it.
  let durationLabel: string | null = null;
  if (!active) {
    const ms =
      new Date(shift.checked_out_at!).getTime() -
      new Date(shift.checked_in_at).getTime();
    if (ms >= 0) {
      const totalMin = Math.round(ms / 60000);
      const hours = Math.floor(totalMin / 60);
      const minutes = totalMin % 60;
      durationLabel = t("duration", { hours, minutes });
    }
  }

  return (
    <article
      data-testid={`shift-card-${shift.id}`}
      data-shift-active={active ? "true" : "false"}
      className="rounded-lg border-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4"
    >
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-lg font-semibold text-[var(--color-accent-ink)]"
        >
          {(shift.caregiver_name || "?").trim().charAt(0).toUpperCase()}
        </span>
        <div className="flex-1">
          <p className="text-base font-semibold text-[var(--color-text)]">
            {shift.caregiver_name || t("unknownCaregiver")}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t("shiftLabel", { checkIn: inLabel, checkOut: outLabel })}
            {durationLabel ? ` · ${durationLabel}` : ""}
          </p>
        </div>
        {active && (
          <span
            className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
            data-testid="shift-active-badge"
          >
            {t("activeBadge")}
          </span>
        )}
      </header>

      {shift.handoff_note && (
        <div className="mt-3 rounded-md bg-[var(--color-accent-soft)] p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {t("handoffLabel")}
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-text)]">
            {shift.handoff_note}
          </p>
        </div>
      )}
    </article>
  );
}
