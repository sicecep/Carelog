"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

// SFT-004 filters: caregiver dropdown + from/to date range.
//
// Submits by navigating to the same page with the filter values in the
// URL, so filters are shareable, bookmarkable, and survive back-button
// navigation — same pattern as the date nav and contributor chips.
export function ShiftHistoryFilters({
  locale,
  caregivers,
  selectedCaregiver,
  from,
  to,
}: {
  locale: string;
  caregivers: Array<{ id: string; name: string }>;
  selectedCaregiver?: string;
  from?: string;
  to?: string;
}) {
  const t = useTranslations("shifts");
  const router = useRouter();

  const push = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams();
      const merged: Record<string, string | undefined> = {
        caregiver: selectedCaregiver,
        from,
        to,
        ...updates,
      };
      for (const [k, v] of Object.entries(merged)) {
        if (v) params.set(k, v);
      }
      const qs = params.toString();
      router.push(`/${locale}/shifts${qs ? `?${qs}` : ""}`);
    },
    [locale, router, selectedCaregiver, from, to],
  );

  const clear = () => router.push(`/${locale}/shifts`);
  const anyActive = Boolean(selectedCaregiver || from || to);

  return (
    <form
      data-testid="shift-history-filters"
      onSubmit={(e) => e.preventDefault()}
      className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-4"
    >
      <div>
        <label
          htmlFor="filter-caregiver"
          className="mb-1 block text-sm font-medium text-[var(--color-text)]"
        >
          {t("filterCaregiver")}
        </label>
        <select
          id="filter-caregiver"
          data-testid="filter-caregiver"
          value={selectedCaregiver ?? ""}
          onChange={(e) => push({ caregiver: e.target.value || undefined })}
          className="input-base w-full"
        >
          <option value="">{t("filterCaregiverAll")}</option>
          {caregivers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="filter-from"
          className="mb-1 block text-sm font-medium text-[var(--color-text)]"
        >
          {t("filterFrom")}
        </label>
        <input
          id="filter-from"
          data-testid="filter-from"
          type="date"
          value={from ?? ""}
          onChange={(e) => push({ from: e.target.value || undefined })}
          className="input-base w-full"
        />
      </div>

      <div>
        <label
          htmlFor="filter-to"
          className="mb-1 block text-sm font-medium text-[var(--color-text)]"
        >
          {t("filterTo")}
        </label>
        <input
          id="filter-to"
          data-testid="filter-to"
          type="date"
          value={to ?? ""}
          onChange={(e) => push({ to: e.target.value || undefined })}
          className="input-base w-full"
        />
      </div>

      <div className="flex items-end">
        <button
          type="button"
          data-testid="filter-clear"
          onClick={clear}
          disabled={!anyActive}
          className="touch-target inline-flex w-full items-center justify-center rounded-lg border-2 border-[var(--color-border-strong)] px-3 text-sm font-medium text-[var(--color-text)] transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--color-border-strong)] disabled:hover:bg-transparent"
        >
          {t("filterClear")}
        </button>
      </div>
    </form>
  );
}
