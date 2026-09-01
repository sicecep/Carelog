"use client";

// Client component for the same reason as dashboard/recipients-section.tsx:
// phosphor-react icons read IconContext via useContext, which Server
// Components can't call. All data arrives as props from the server page.

import { useTranslations } from "next-intl";
import { Baby, User, Users, Heart, WarningCircle } from "phosphor-react";
import { CARE_TYPES, MODULES, type CareType, type Module } from "@/lib/constants.generated";
import type { Incident, Recipient, ReportEntry } from "@/lib/api-client";

const careTypeIcons = {
  infant: Baby,
  child: User,
  elderly: Users,
  patient: Heart,
};

// INC-003 severity weighting (user decision): low=amber, medium=red,
// high/emergency=deep red. Pulsing/share treatment comes with the dedicated
// incident work — here we only tint the timeline chips.
const severityStyles: Record<Incident["severity"], string> = {
  low: "bg-amber-100 text-amber-900",
  medium: "bg-red-100 text-red-900",
  high: "bg-red-200 text-red-950",
  emergency: "bg-red-200 text-red-950",
};

function isCareType(value: string): value is CareType {
  return (CARE_TYPES as readonly string[]).includes(value);
}

function isModule(value: string): value is Module {
  return (MODULES as readonly string[]).includes(value);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function DetailHeader({ recipient }: { recipient: Recipient }) {
  const tRecipients = useTranslations("recipients");
  const tOnboarding = useTranslations("onboarding");

  const name = recipient.display_name?.trim() || recipient.full_name;
  const initial = name.trim().charAt(0).toUpperCase();
  const careType = isCareType(recipient.care_type) ? recipient.care_type : null;
  const CareIcon = careType ? careTypeIcons[careType] : null;
  const modules = (recipient.enabled_modules ?? []).filter(isModule);

  return (
    <section className="card">
      <div className="flex items-start gap-5">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-2xl font-semibold text-[var(--color-accent-ink)]"
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-medium text-[var(--color-text)]">{name}</h1>
          {careType && CareIcon && (
            <p className="mt-1 flex items-center gap-1.5 text-base text-[var(--color-text-muted)]">
              <CareIcon size={20} weight="thin" aria-hidden="true" />
              <span>{tRecipients(`careTypes.${careType}`)}</span>
            </p>
          )}
        </div>
      </div>

      {modules.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {modules.map((module) => (
            <li
              key={module}
              className="rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm text-[var(--color-accent-ink)]"
            >
              {tOnboarding(`modules.${module}`)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function IncidentList({ incidents }: { incidents: Incident[] }) {
  const tIncidents = useTranslations("incidents");
  if (incidents.length === 0) return null;

  return (
    <ul className="space-y-3">
      {incidents.map((incident) => (
        <li key={incident.id} className="card flex items-start gap-3">
          <WarningCircle
            size={24}
            weight="fill"
            aria-hidden="true"
            className={
              incident.severity === "low" ? "text-amber-500" : "text-red-600"
            }
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--color-text)]">
                {tIncidents(`types.${incident.type}`)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityStyles[incident.severity]}`}
              >
                {tIncidents(`severities.${incident.severity}`)}
              </span>
              <span className="ml-auto text-sm text-[var(--color-text-muted)]">
                {formatTime(incident.occurred_at)}
              </span>
            </div>
            <p className="mt-1 text-base text-[var(--color-text)]">{incident.description}</p>
            {incident.reporter_name && (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {incident.reporter_name}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TimelineList({
  entries,
  incidents,
}: {
  entries: ReportEntry[];
  incidents: Incident[];
}) {
  const t = useTranslations("recipients");
  const tOnboarding = useTranslations("onboarding");
  const tLogging = useTranslations("logging");

  if (entries.length === 0 && incidents.length === 0) {
    return (
      <p className="card text-base text-[var(--color-text-muted)]">
        {t("detailTimelineEmpty")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* RPT-001.6: incidents pinned above the day's entries. */}
      <IncidentList incidents={incidents} />

      {entries.length > 0 && (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="card flex items-start gap-3">
              <span className="w-14 shrink-0 pt-0.5 text-sm text-[var(--color-text-muted)]">
                {formatTime(entry.occurred_at)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[var(--color-text)]">
                    {isModule(entry.category)
                      ? tOnboarding(`modules.${entry.category}`)
                      : entry.category}
                  </span>
                  {entry.subcategory && (
                    <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-xs text-[var(--color-accent-ink)]">
                      {tLogging(`subcategories.${entry.category}.${entry.subcategory}`)}
                    </span>
                  )}
                </div>
                {entry.value_text && (
                  <p className="mt-1 text-base text-[var(--color-text)]">{entry.value_text}</p>
                )}
                {entry.contributor_name && (
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {entry.contributor_name}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
