"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Contributor chips for the recipient timeline (RPT-002).
 *
 * A horizontally scrollable row of chips: "All" plus one per contributor
 * who wrote at least one entry or incident on the visible day.
 *
 * The chips are real <Link>s carrying the `?contributor=<uuid>` state so
 * the browser back button, "copy link", and shared URLs all preserve the
 * filter — same treatment as the date nav. The active chip is derived
 * from the URL, not from local state, so a server-side render with a
 * ?contributor= param already highlights the right chip on first paint.
 *
 * Preserves the current `?date=` so switching contributors doesn't
 * silently jump the caller back to today.
 */
export function ContributorChips({
  locale,
  recipientId,
  contributors,
  activeContributorId,
  date,
}: {
  locale: string;
  recipientId: string;
  /** All contributors who touched this day. Order is preserved. */
  contributors: Array<{ id: string; name: string }>;
  /** The currently filtered contributor id, or undefined for "All". */
  activeContributorId?: string;
  /** The currently viewed day (YYYY-MM-DD), preserved across chip clicks. */
  date: string;
}) {
  const t = useTranslations("timeline");

  // De-dupe by id: an owner who both wrote an entry AND filed an incident
  // would otherwise show up twice.
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return contributors.filter((c) => {
      if (!c.id || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [contributors]);

  // If only one person contributed, the filter is noise — hide it.
  if (unique.length <= 1) return null;

  const hrefFor = (contributorId?: string) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (contributorId) params.set("contributor", contributorId);
    const qs = params.toString();
    return `/${locale}/recipients/${recipientId}${qs ? `?${qs}` : ""}`;
  };

  const isAll = !activeContributorId;

  return (
    <nav
      aria-label={t("contributorFilterLabel")}
      data-testid="contributor-chips"
      // overflow-x-auto keeps the row scrollable on narrow phones without
      // wrapping — the PRD calls for horizontally scrollable chips
      // specifically so the tap targets never shrink.
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      <ChipLink
        href={hrefFor(undefined)}
        active={isAll}
        testid="contributor-chip-all"
        label={t("contributorAll")}
      />
      {unique.map((c) => (
        <ChipLink
          key={c.id}
          href={hrefFor(c.id)}
          active={c.id === activeContributorId}
          testid={`contributor-chip-${c.id}`}
          label={c.name || t("contributorUnknown")}
        />
      ))}
    </nav>
  );
}

function ChipLink({
  href,
  active,
  testid,
  label,
}: {
  href: string;
  active: boolean;
  testid: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testid}
      aria-current={active ? "true" : undefined}
      // scroll={false} so tapping a chip doesn't yank the caregiver back
      // to the top on a long timeline — this is a filter, not a navigation.
      scroll={false}
      className={cn(
        "touch-target inline-flex shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 text-sm font-medium transition-all",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]"
          : "border-[var(--color-border-strong)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]",
      )}
    >
      {label}
    </Link>
  );
}
