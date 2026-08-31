"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Warning, WarningCircle, WarningOctagon } from "phosphor-react";
import { cn } from "@/lib/utils";
import {
  APIError,
  incidentApi,
  type Incident,
  type IncidentSeverity,
  type IncidentType,
} from "@/lib/api-client";

interface IncidentSheetProps {
  /** Whether the sheet is open. Controlled by the parent (red FAB). */
  open: boolean;
  onClose: () => void;
  recipientId: string;
  workspaceId: string;
  /** Called after a successful save so the parent can refresh the incident list. */
  onLogged?: (incident: Incident) => void;
}

type Step = "severity" | "details" | "success";

// Native notification for high/emergency incidents (INC-004).
// Tries Web Notification API first (persistent, requiresInteraction), falls
// back to blocking alert() so the signal is never lost.
async function notifyUrgent(title: string, body: string) {
  if (typeof window !== "undefined" && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification(title, { body, requireInteraction: true });
      return;
    } else if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        new Notification(title, { body, requireInteraction: true });
        return;
      }
    }
  }
  alert(`${title.toUpperCase()}\n\n${body}`);
}

// Severity picker (INC-003). Three severities plus emergency; every level pairs
// colour with an icon and a text label so the meaning is never carried by
// colour alone — critical for the "Bu Sari" accessibility bar and for the
// small colour-blind subset of Indonesian users.
const SEVERITY_TILES: {
  id: IncidentSeverity;
  icon: typeof Warning;
  labelKey: string;
  descKey: string;
  cls: string;
}[] = [
  {
    id: "low",
    icon: Warning,
    labelKey: "severity.low.label",
    descKey: "severity.low.desc",
    cls: "border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100",
  },
  {
    id: "medium",
    icon: WarningCircle,
    labelKey: "severity.medium.label",
    descKey: "severity.medium.desc",
    cls: "border-orange-600 bg-orange-50 text-orange-900 hover:bg-orange-100",
  },
  {
    id: "high",
    icon: WarningOctagon,
    labelKey: "severity.high.label",
    descKey: "severity.high.desc",
    cls: "border-red-600 bg-red-50 text-red-900 hover:bg-red-100",
  },
  {
    id: "emergency",
    icon: WarningOctagon,
    labelKey: "severity.emergency.label",
    descKey: "severity.emergency.desc",
    cls: "border-red-800 bg-red-100 text-red-950 hover:bg-red-200 animate-pulse",
  },
];

const INCIDENT_TYPES: IncidentType[] = [
  "fall",
  "injury",
  "medical",
  "behavioral",
  "environmental",
  "other",
];

const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 1000;
const ACTION_MAX = 500;

/**
 * Emergency-path bottom sheet for INC-001/INC-002. Reachable in one tap from
 * anywhere in the app; must work even when the caregiver has NOT checked into
 * a shift. Submission is 3 taps in the happy path:
 *   1. Tap severity
 *   2. Tap incident type
 *   3. Type description → tap Submit
 */
export function IncidentSheet({
  open,
  onClose,
  recipientId,
  workspaceId,
  onLogged,
}: IncidentSheetProps) {
  const t = useTranslations("incidentsheet");
  const tIncidents = useTranslations("incidents");

  const [step, setStep] = useState<Step>("severity");
  const [severity, setSeverity] = useState<IncidentSeverity | null>(null);
  const [type, setType] = useState<IncidentType | null>(null);
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("severity");
    setSeverity(null);
    setType(null);
    setDescription("");
    setActionTaken("");
    setSubmitting(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSeveritySelect = useCallback((s: IncidentSeverity) => {
    setSeverity(s);
    setError(null);
    setStep("details");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!severity || !type) return;
    if (description.trim().length < DESCRIPTION_MIN) {
      setError(t("descriptionTooShort", { min: DESCRIPTION_MIN }));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await incidentApi.create(workspaceId, recipientId, {
        type,
        severity,
        description: description.trim(),
        action_taken: actionTaken.trim() || undefined,
      });
      if (res.data) onLogged?.(res.data);

      // INC-004: high/emergency incidents must break through ambient attention.
      // The owner's push+email is sent server-side; this is the local signal to
      // the caregiver that the urgent report actually left the device — they
      // are often mid-crisis and will not read a subtle toast.
      if (severity === "high" || severity === "emergency") {
        void notifyUrgent(t("urgentNotifyTitle"), t("urgentNotifyBody"));
      }

      setStep("success");
      setTimeout(handleClose, 1500);
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }, [severity, type, description, actionTaken, workspaceId, recipientId, onLogged, handleClose, t]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incident-sheet-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg overflow-y-auto rounded-t-xl bg-[var(--color-surface)] p-5 shadow-lg sm:max-h-[85vh] sm:rounded-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="incident-sheet-title"
            className="text-xl font-semibold text-[var(--color-text)]"
          >
            {t("title")}
          </h2>
          <button
            type="button"
            aria-label={t("close")}
            onClick={handleClose}
            className="btn-base btn-ghost btn-icon touch-target"
          >
            <X size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {step === "severity" && (
          <div>
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              {t("selectSeverity")}
            </p>
            <div className="flex flex-col gap-3">
              {SEVERITY_TILES.map(({ id, icon: Icon, labelKey, descKey, cls }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSeveritySelect(id)}
                  className={cn(
                    "touch-target flex min-h-[64px] items-center gap-3 rounded-lg border-2 p-4 text-left transition-all",
                    cls
                  )}
                >
                  <Icon size={28} weight="fill" aria-hidden="true" />
                  <div className="flex flex-col">
                    <span className="text-base font-semibold">{t(labelKey)}</span>
                    <span className="text-sm opacity-80">{t(descKey)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "details" && severity && (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => setStep("severity")}
              className="text-sm font-medium text-[var(--color-accent)] touch-target"
            >
              {t("changeSeverity")}
            </button>

            <fieldset>
              <legend className="mb-2 text-base font-semibold text-[var(--color-text)]">
                {tIncidents("type")}
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {INCIDENT_TYPES.map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setType(tp)}
                    className={cn(
                      "chip touch-target min-h-[56px] text-sm font-medium transition-all",
                      type === tp
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                        : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
                    )}
                  >
                    {tIncidents(`types.${tp}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="incident-description"
                className="mb-1 block text-base font-semibold text-[var(--color-text)]"
              >
                {tIncidents("description")}{" "}
                <span className="text-sm font-normal text-[var(--color-text-muted)]">
                  ({t("min", { n: DESCRIPTION_MIN })})
                </span>
              </label>
              <textarea
                id="incident-description"
                rows={4}
                maxLength={DESCRIPTION_MAX}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                className="input-base w-full resize-y py-3"
              />
              <p className="mt-1 text-right text-xs text-[var(--color-text-muted)]">
                {description.length}/{DESCRIPTION_MAX}
              </p>
            </div>

            <div>
              <label
                htmlFor="incident-action"
                className="mb-1 block text-base font-semibold text-[var(--color-text)]"
              >
                {t("actionTaken")}{" "}
                <span className="text-sm font-normal text-[var(--color-text-muted)]">
                  ({t("optional")})
                </span>
              </label>
              <textarea
                id="incident-action"
                rows={2}
                maxLength={ACTION_MAX}
                value={actionTaken}
                onChange={(e) => setActionTaken(e.target.value)}
                placeholder={t("actionTakenPlaceholder")}
                className="input-base w-full resize-y py-3"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-[var(--color-error-ink)]">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("severity")}
                className="btn-base btn-secondary flex-1 touch-target"
              >
                {t("back")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !type || description.trim().length < DESCRIPTION_MIN}
                className="btn-base btn-primary flex-1 touch-target disabled:opacity-50"
              >
                {submitting ? t("submitting") : t("submit")}
              </button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="toast-success flex items-center gap-2 py-4" role="status">
            <span className="text-lg font-medium">{t("submitted")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
