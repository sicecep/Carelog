"use client";

// Client pieces of the "Hari Ini" home screen. Client only because the sheets
// hold open/close state and phosphor icons read React context; all data
// arrives as props from the server page.

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { WarningOctagon, CaretRight, Warning } from "phosphor-react";
import type { LogCategory, Module } from "@/lib/constants.generated";
import { CATEGORY_ORDER, CategoryIcon } from "@/components/ui/CategoryIcon";
import { LogFlow } from "@/components/ui/LogFlow";

interface QuickLogProps {
  recipientId: string;
  recipientName: string;
  workspaceId: string;
  modules: readonly Module[];
  /** Today's last entry time per category, already formatted ("12.10"). */
  lastLogged: Partial<Record<LogCategory, string>>;
  shiftPrompt?: { caregiverId: string; offShift: boolean };
}

/**
 * "Catat cepat": one tile per enabled category. A tile opens the logging
 * sheet straight on that category's options, so a log is tile → option →
 * saved (DESIGN.md rule 1: ≤ 3 taps). Each tile also shows when it was last
 * logged today, so a caregiver can see at a glance what is still missing.
 */
export function QuickLog({
  recipientId,
  recipientName,
  workspaceId,
  modules,
  lastLogged,
  shiftPrompt,
}: QuickLogProps) {
  const t = useTranslations("today");
  const tCategories = useTranslations("reports.categories");
  const tIncidents = useTranslations("incidents");

  // A recipient saved before modules existed has none; offer everything.
  const categories =
    modules.length === 0 ? CATEGORY_ORDER : CATEGORY_ORDER.filter((c) => modules.includes(c));

  return (
    <LogFlow
      recipientId={recipientId}
      workspaceId={workspaceId}
      modules={modules}
      shiftPrompt={shiftPrompt}
    >
      {({ openLogging, openIncident }) => (
        <section aria-labelledby="quick-log-heading">
          <h2 id="quick-log-heading" className="mb-3 text-xl font-semibold text-[var(--color-text)]">
            {t("quickLogFor", { name: recipientName })}
          </h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {categories.map((cat) => {
              const last = lastLogged[cat];
              const label = tCategories(cat);
              return (
                <li key={cat}>
                  <button
                    type="button"
                    onClick={() => openLogging(cat)}
                    data-testid={`quick-log-${cat}`}
                    aria-label={
                      last
                        ? t("tileAria", { category: label, time: last })
                        : t("tileAriaNone", { category: label })
                    }
                    className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1 py-3 text-center transition-transform duration-[120ms] hover:bg-[var(--color-surface-hover)] active:scale-[0.97]"
                  >
                    <CategoryIcon category={cat} size="lg" />
                    <span className="text-base font-medium leading-tight text-[var(--color-text)]">
                      {label}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`rounded-full px-2 text-sm tabular-nums ${
                        last
                          ? "bg-[var(--color-highlight-soft)] text-[var(--color-highlight-ink)]"
                          : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      {last ?? t("tileNone")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Incident reporting never waits behind the shift nudge. */}
          <button
            type="button"
            onClick={openIncident}
            data-testid="home-open-incident"
            className="btn-base touch-target mt-4 w-full bg-[var(--color-surface)] text-base text-[var(--color-error-ink)] ring-2 ring-[var(--color-error)] ring-inset hover:bg-[var(--color-error-soft)]"
          >
            <WarningOctagon size={22} aria-hidden="true" />
            <span>{tIncidents("report")}</span>
          </button>
        </section>
      )}
    </LogFlow>
  );
}

export interface RecipientTodaySummary {
  id: string;
  name: string;
  lastMeal?: string;
  lastMedication?: string;
  entryCount: number;
  incidentCount: number;
  /** i18n key suffix of the most severe incident today, if any. */
  topSeverity?: "low" | "medium" | "high" | "emergency";
}

/** Owner home: one card per recipient with today at a glance. The whole
 *  card opens the recipient's timeline. */
export function RecipientTodayCard({ summary }: { summary: RecipientTodaySummary }) {
  const t = useTranslations("today");
  const tDashboard = useTranslations("dashboard");
  const tSeverity = useTranslations("incidents.severities");
  const locale = useLocale();
  const initial = summary.name.trim().charAt(0).toUpperCase();

  const stats = [
    { label: t("lastMeal"), value: summary.lastMeal ?? "—" },
    { label: t("lastMedication"), value: summary.lastMedication ?? "—" },
    { label: t("entriesToday"), value: String(summary.entryCount) },
    { label: t("incidentsToday"), value: String(summary.incidentCount) },
  ];

  return (
    <Link
      href={`/${locale}/recipients/${summary.id}`}
      aria-label={tDashboard("openRecipient", { name: summary.name })}
      className="card block transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-lg font-semibold text-[var(--color-accent-ink)]"
        >
          {initial}
        </span>
        <h3 className="min-w-0 flex-1 text-lg font-semibold wrap-anywhere text-[var(--color-text)]">
          {summary.name}
        </h3>
        <CaretRight size={22} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md bg-[var(--color-bg)] px-3 py-2">
            <dt className="text-sm text-[var(--color-text-muted)]">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-[var(--color-text)]">{s.value}</dd>
          </div>
        ))}
      </dl>
      {summary.topSeverity && (
        // Status = colour + icon + text (DESIGN.md rule 8).
        <p
          className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-base font-medium ${
            summary.topSeverity === "low"
              ? "bg-[var(--color-sev-low-soft)] text-[var(--color-sev-low-ink)]"
              : summary.topSeverity === "medium"
                ? "bg-[var(--color-sev-medium-soft)] text-[var(--color-sev-medium-ink)]"
                : "bg-[var(--color-sev-high-soft)] text-[var(--color-sev-high-ink)]"
          }`}
        >
          <Warning size={20} weight="fill" aria-hidden="true" className="shrink-0" />
          <span>
            {t("incidentAlert", {
              count: summary.incidentCount,
              severity: tSeverity(summary.topSeverity),
            })}
          </span>
        </p>
      )}
    </Link>
  );
}
