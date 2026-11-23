"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CaretLeft, CaretRight } from "phosphor-react";

/**
 * Date navigation for the recipient timeline (RPT-003 / OWN-009).
 *
 * Prev/next are real <Link>s rather than buttons so the browser back button,
 * middle-click, and "copy link" all behave — an owner comparing two days
 * shouldn't lose their place. The date input is the direct-jump path for
 * anything further than a few taps away.
 *
 * "Today" is computed by the CALLER and passed in, not derived here: the
 * server already knows the workspace timezone, and a browser in a different
 * zone would otherwise disagree about which day is today and render a
 * "next day" arrow into the future.
 */
export function DateNav({
  locale,
  recipientId,
  date,
  today,
  minDate,
}: {
  locale: string;
  recipientId: string;
  /** Currently displayed day, YYYY-MM-DD. */
  date: string;
  /** Today in the workspace timezone, YYYY-MM-DD. */
  today: string;
  /** Oldest reachable day on this plan, YYYY-MM-DD; undefined = unlimited. */
  minDate?: string;
}) {
  const t = useTranslations("timeline");
  const router = useRouter();

  const hrefFor = (d: string) => `/${locale}/recipients/${recipientId}?date=${d}`;

  const shift = (days: number) => {
    // Parse as UTC and shift in whole days: constructing a local Date from
    // "YYYY-MM-DD" then calling setDate() lands on the wrong day for any
    // browser behind UTC, which would silently skip a day for a user in,
    // say, Los Angeles reading a Jakarta workspace.
    const [y, m, dd] = d2parts(d2(date));
    const base = Date.UTC(y, m - 1, dd);
    return new Date(base + days * 86400000).toISOString().slice(0, 10);
  };

  const prev = shift(-1);
  const next = shift(1);

  const atOldest = minDate !== undefined && prev < minDate;
  const atNewest = date >= today;

  return (
    <nav
      aria-label={t("dateNavLabel")}
      className="flex items-center justify-between gap-2"
      data-testid="date-nav"
    >
      {atOldest ? (
        // Disabled rather than hidden: the boundary is information. A Free
        // owner should see that older days exist and are simply out of reach.
        <span
          role="link"
          aria-disabled="true"
          aria-label={t("prevDay")}
          data-testid="date-prev-disabled"
          className="touch-target inline-flex shrink-0 cursor-not-allowed items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-50"
        >
          <CaretLeft size={24} weight="bold" aria-hidden="true" />
        </span>
      ) : (
        <Link
          href={hrefFor(prev)}
          aria-label={t("prevDay")}
          data-testid="date-prev"
          className="touch-target inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--color-border-control)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
        >
          <CaretLeft size={24} weight="bold" aria-hidden="true" />
        </Link>
      )}

      {/* Prev/next are 56px icon buttons (labelled for screen readers): the
          text labels were clipped to "Sebelumny…" at 360px. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor="timeline-date" className="sr-only">
          {t("dateLabel")}
        </label>
        <input
          id="timeline-date"
          type="date"
          value={date}
          max={today}
          min={minDate}
          onChange={(e) => {
            const v = e.target.value;
            if (v) router.push(hrefFor(v));
          }}
          data-testid="date-input"
          className="input-base min-w-0 flex-1 px-3 text-base"
        />
        {date !== today && (
          <Link
            href={hrefFor(today)}
            data-testid="date-today"
            className="touch-target inline-flex shrink-0 items-center rounded-md border border-[var(--color-border-control)] px-3 text-base text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
          >
            {t("today")}
          </Link>
        )}
      </div>

      {atNewest ? (
        <span
          role="link"
          aria-disabled="true"
          aria-label={t("nextDay")}
          data-testid="date-next-disabled"
          className="touch-target inline-flex shrink-0 cursor-not-allowed items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-50"
        >
          <CaretRight size={24} weight="bold" aria-hidden="true" />
        </span>
      ) : (
        <Link
          href={hrefFor(next)}
          aria-label={t("nextDay")}
          data-testid="date-next"
          className="touch-target inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--color-border-control)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
        >
          <CaretRight size={24} weight="bold" aria-hidden="true" />
        </Link>
      )}
    </nav>
  );
}

/** Narrow a YYYY-MM-DD string, falling back to today's UTC date if malformed. */
function d2(s: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

function d2parts(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}
