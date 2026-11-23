"use client";

/* eslint-disable @next/next/no-img-element -- uploaded photos are remote
   storage URLs (per-deployment host); next/image would require every
   deployment to preconfigure remotePatterns for no optimization win. */

// Client component for the same reason as dashboard/recipients-section.tsx:
// phosphor-react icons read IconContext via useContext, which Server
// Components can't call. All data arrives as props from the server page.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Baby,
  User,
  Users,
  Heart,
  WarningCircle,
  WhatsappLogo,
  CheckCircle,
  ClipboardText,
  PencilSimple,
} from "phosphor-react";
import { CARE_TYPES, MODULES, VITAL_SPECS, type CareType, type Module } from "@/lib/constants.generated";
import { APIError, incidentApi, type Incident, type Recipient, type ReportEntry } from "@/lib/api-client";
import { buildWhatsAppShareUrl } from "@/components/ui/IncidentSheet";
import { SummarySheet } from "@/components/ui/SummarySheet";
import { formatClock } from "@/lib/format-time";
import { EditRecipientSheet } from "@/components/ui/EditRecipientSheet";

// formatVitalMeasurement renders a stored vital for the timeline (CGR-009):
// single-field vitals as "36.8 °C", blood pressure as "120/80 mmHg".
function formatVitalMeasurement(subcategory: string, values: Record<string, number>): string {
  const spec = VITAL_SPECS[subcategory];
  if (!spec) return "";
  if (values.systolic !== undefined && values.diastolic !== undefined) {
    return `${values.systolic}/${values.diastolic} ${spec.unit}`;
  }
  if (values.value !== undefined) {
    return `${values.value} ${spec.unit}`;
  }
  return "";
}

const careTypeIcons = {
  infant: Baby,
  child: User,
  elderly: Users,
  patient: Heart,
};

// INC-003 severity colours from the --color-sev-* tokens (DESIGN.md §2.3):
// low=green, medium=amber, high=red, emergency=solid deep red with a pulsing
// outer ring. Replaces the earlier low=amber/medium=red mapping (user decision
// 2026-11-22, aligning with the PRD). Badge text always carries the label.
const severityStyles: Record<Incident["severity"], string> = {
  low: "bg-sev-low-soft text-sev-low-ink",
  medium: "bg-sev-medium-soft text-sev-medium-ink",
  high: "bg-sev-high-soft text-sev-high-ink",
  emergency: "sev-emergency-ring bg-sev-emergency text-white",
};

const severityIconStyles: Record<Incident["severity"], string> = {
  low: "text-sev-low",
  medium: "text-sev-medium",
  high: "text-sev-high",
  emergency: "text-sev-emergency",
};

function isCareType(value: string): value is CareType {
  return (CARE_TYPES as readonly string[]).includes(value);
}

function isModule(value: string): value is Module {
  return (MODULES as readonly string[]).includes(value);
}


interface DetailHeaderProps {
  recipient: Recipient;
  /**
   * Set for owners only: shows "Ubah profil" and its sheet. Profile edits
   * are owner-only (AUTH-004), and the API enforces it too.
   */
  editWorkspaceId?: string;
}

export function DetailHeader({ recipient, editWorkspaceId }: DetailHeaderProps) {
  const tRecipients = useTranslations("recipients");
  const tOnboarding = useTranslations("onboarding");
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);

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

      {/* Own row, not beside the name: at 360px a button there squeezes
          the name down to its first letter. */}
      {editWorkspaceId && (
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="btn-base btn-secondary touch-target mt-4 gap-1.5 px-3 text-sm"
        >
          <PencilSimple size={18} weight="bold" aria-hidden="true" />
          <span>{tRecipients("editOpen")}</span>
        </button>
      )}

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

      {editWorkspaceId && (
        <EditRecipientSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          recipient={recipient}
          workspaceId={editWorkspaceId}
          // The page is a Server Component: refresh re-reads the new name.
          onUpdated={() => router.refresh()}
        />
      )}
    </section>
  );
}

// INC-ACK (PRD §6.5): owner-only acknowledge with an optional comment. A tiny
// inline form rather than a sheet — this is a lightweight, single-field action
// invoked directly from the timeline card.
function AckButton({
  incident,
  workspaceId,
}: {
  incident: Incident;
  workspaceId: string;
}) {
  const t = useTranslations("incidents");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAcknowledge = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await incidentApi.acknowledge(workspaceId, incident.id, {
        comment: comment.trim() || undefined,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("ackErrorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }, [comment, workspaceId, incident.id, router, t]);

  if (incident.acknowledged_at) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-sm text-[var(--color-accent-ink)]">
        <CheckCircle size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{t("acknowledged")}</p>
          {incident.ack_comment && <p className="mt-0.5">{incident.ack_comment}</p>}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[var(--color-border-control)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
      >
        <CheckCircle size={20} weight="regular" aria-hidden="true" />
        <span>{t("acknowledge")}</span>
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea
        rows={2}
        maxLength={500}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("ackCommentPlaceholder")}
        className="input-base w-full resize-y py-2 text-sm"
      />
      {error && (
        <p role="alert" className="text-sm text-[var(--color-error-ink)]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-base btn-secondary touch-target flex-1 text-sm"
        >
          {t("ackCancel")}
        </button>
        <button
          type="button"
          onClick={handleAcknowledge}
          disabled={submitting}
          className="btn-base btn-primary touch-target flex-1 text-sm disabled:opacity-50"
        >
          {submitting ? t("ackSubmitting") : t("acknowledge")}
        </button>
      </div>
    </div>
  );
}

export function IncidentList({
  incidents,
  isOwner,
  workspaceId,
  timezone,
}: {
  incidents: Incident[];
  isOwner?: boolean;
  workspaceId?: string;
  /** Workspace IANA zone: times are the household's wall clock. */
  timezone?: string;
}) {
  const locale = useLocale();
  const tIncidents = useTranslations("incidents");
  const tSheet = useTranslations("incidentsheet");
  if (incidents.length === 0) return null;

  return (
    <ul className="space-y-3">
      {incidents.map((incident) => {
        // INC-003: owners re-share urgent incidents into the family WhatsApp
        // group straight from the timeline.
        const urgent = incident.severity === "high" || incident.severity === "emergency";
        return (
          <li key={incident.id} className="card flex items-start gap-3">
            <WarningCircle
              size={24}
              weight="fill"
              aria-hidden="true"
              className={severityIconStyles[incident.severity]}
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
                  {formatClock(incident.occurred_at, locale, timezone)}
                </span>
              </div>
              <p className="mt-1 text-base text-[var(--color-text)]">{incident.description}</p>
              {/* CGR-015: incident photos, same treatment as entry photos —
                  tap to open the full image in a new tab. */}
              {incident.photo_urls && incident.photo_urls.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2" data-testid="incident-photos">
                  {incident.photo_urls.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={url}
                          alt=""
                          loading="lazy"
                          className="h-20 w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-soft)] object-cover"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {incident.reporter_name && (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {incident.reporter_name}
                </p>
              )}
              {urgent && (
                <a
                  href={buildWhatsAppShareUrl(
                    tSheet("shareMessage", {
                      type: tIncidents(`types.${incident.type}`),
                      severity: tIncidents(`severities.${incident.severity}`),
                      description: incident.description,
                      action: incident.action_taken || "-",
                    })
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[var(--color-whatsapp)] px-4 py-2 text-sm font-semibold text-[var(--color-whatsapp-ink)] hover:bg-[var(--color-whatsapp-hover)]"
                >
                  <WhatsappLogo size={20} weight="fill" aria-hidden="true" />
                  <span>{tSheet("shareWhatsApp")}</span>
                </a>
              )}
              {/* INC-ACK: owner-only acknowledgment, PRD §6.5 P1. */}
              {isOwner && workspaceId && (
                <AckButton incident={incident} workspaceId={workspaceId} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TimelineList({
  entries,
  incidents,
  isOwner,
  workspaceId,
  timezone,
}: {
  entries: ReportEntry[];
  incidents: Incident[];
  isOwner?: boolean;
  workspaceId?: string;
  /** Workspace IANA zone: times are the household's wall clock. */
  timezone?: string;
}) {
  const locale = useLocale();
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
      <IncidentList incidents={incidents} isOwner={isOwner} workspaceId={workspaceId} timezone={timezone} />

      {entries.length > 0 && (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="card flex items-start gap-3">
              <span className="w-14 shrink-0 pt-0.5 text-sm text-[var(--color-text-muted)]">
                {formatClock(entry.occurred_at, locale, timezone)}
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
                {entry.value_json && entry.subcategory && VITAL_SPECS[entry.subcategory] && (
                  <p className="mt-1 text-base font-semibold tabular-nums text-[var(--color-text)]">
                    {formatVitalMeasurement(entry.subcategory, entry.value_json)}
                  </p>
                )}
                {entry.value_number !== undefined && entry.value_number !== null && (
                  <p className="mt-1 text-base font-semibold tabular-nums text-[var(--color-text)]">
                    ×{entry.value_number}
                  </p>
                )}
                {entry.photo_urls && entry.photo_urls.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {entry.photo_urls.map((url) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                          <img
                            src={url}
                            alt=""
                            loading="lazy"
                            className="h-20 w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-soft)] object-cover"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
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

// DaySummaryTrigger opens the CGR-007 day-end count summary from the timeline
// heading. Rendered only for writers (owner/caregiver); a viewer's button
// would be a dead control — the API 403s them.
export function DaySummaryTrigger({
  recipientId,
  workspaceId,
  modules,
}: {
  recipientId: string;
  workspaceId: string;
  modules: Module[];
}) {
  const t = useTranslations("recipients");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogged = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-base btn-ghost touch-target text-sm font-semibold"
      >
        <ClipboardText size={18} weight="bold" aria-hidden="true" />
        <span className="ml-1">{t("summaryTrigger")}</span>
      </button>
      <SummarySheet
        open={open}
        onClose={() => setOpen(false)}
        recipientId={recipientId}
        workspaceId={workspaceId}
        modules={modules}
        onLogged={handleLogged}
      />
    </>
  );
}
