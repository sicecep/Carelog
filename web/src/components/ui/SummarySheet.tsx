"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { X, CheckCircle, Minus, Plus } from "phosphor-react";
import { cn } from "@/lib/utils";
import { type LogCategory, type Module } from "@/lib/constants.generated";
import { recipientApi, APIError } from "@/lib/api-client";

interface SummarySheetProps {
  /** Whether the sheet is open. Controlled by the parent. */
  open: boolean;
  onClose: () => void;
  recipientId: string;
  workspaceId: string;
  /** The recipient's enabled modules — steppers render for these (minus note). */
  modules: Module[];
  /** Called after a successful save so the parent can refresh the timeline. */
  onLogged?: () => void;
}

const COUNT_MAX = 99;
const NOTE_MAX = 500;

// CGR-007: day-end count-based summary. A caregiver who did not log in real
// time enters per-category counts once, at the end of the day, so a record
// still exists. One submit creates one entry per nonzero count plus an
// optional note — all visible on the owner's timeline immediately after.
export function SummarySheet({ open, onClose, recipientId, workspaceId, modules, onLogged }: SummarySheetProps) {
  const t = useTranslations("summarysheet");
  const tModules = useTranslations("onboarding.modules");

  const [counts, setCounts] = useState<Partial<Record<LogCategory, number>>>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Steppers cover the recipient's enabled modules; note is not countable
  // (it gets its own textarea) and other never carries meaning.
  const countable = useMemo(
    () => modules.filter((m) => m !== "note"),
    [modules]
  );

  const reset = useCallback(() => {
    setCounts({});
    setNote("");
    setSubmitting(false);
    setSuccess(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const bump = useCallback((cat: LogCategory, delta: number) => {
    setError(null);
    setCounts((prev) => {
      const next = Math.min(COUNT_MAX, Math.max(0, (prev[cat] ?? 0) + delta));
      return { ...prev, [cat]: next };
    });
  }, []);

  const hasCounts = Object.values(counts).some((n) => (n ?? 0) > 0);

  const submit = useCallback(() => {
    setSubmitting(true);
    setError(null);
    const payload: { counts: Partial<Record<LogCategory, number>>; note?: string } = { counts: {} };
    for (const [cat, n] of Object.entries(counts)) {
      if ((n ?? 0) > 0) {
        payload.counts[cat as LogCategory] = n as number;
      }
    }
    const trimmed = note.trim();
    if (trimmed) payload.note = trimmed;
    recipientApi
      .submitDaySummary(workspaceId, recipientId, payload)
      .then(() => {
        setSuccess(true);
        onLogged?.();
        setTimeout(handleClose, 1200);
      })
      .catch((err) => {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      })
      .finally(() => setSubmitting(false));
  }, [counts, note, workspaceId, recipientId, onLogged, handleClose, t]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-summary-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-t-xl bg-[var(--color-surface)] p-5 shadow-lg sm:rounded-xl sm:p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="day-summary-title" className="text-xl font-medium text-[var(--color-text)]">
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

        {success ? (
          <div className="toast-success flex items-center gap-2" role="status">
            <CheckCircle size={20} weight="fill" aria-hidden="true" />
            <span>{t("saved")}</span>
          </div>
        ) : (
          <div>
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">{t("hint")}</p>

            <ul className="space-y-3">
              {countable.map((cat) => {
                const n = counts[cat] ?? 0;
                return (
                  <li
                    key={cat}
                    className="flex items-center justify-between rounded-lg border-[1.5px] border-[var(--color-border-strong)] px-3 py-2"
                  >
                    <span className="text-base font-medium text-[var(--color-text)]">
                      {tModules(cat)}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        aria-label={t("decrease", { category: tModules(cat) })}
                        disabled={n === 0}
                        onClick={() => bump(cat, -1)}
                        className="btn-base btn-ghost btn-icon touch-target disabled:opacity-40"
                      >
                        <Minus size={18} weight="bold" aria-hidden="true" />
                      </button>
                      <span className="w-8 text-center text-base font-semibold tabular-nums text-[var(--color-text)]">
                        {n}
                      </span>
                      <button
                        type="button"
                        aria-label={t("increase", { category: tModules(cat) })}
                        disabled={n >= COUNT_MAX}
                        onClick={() => bump(cat, 1)}
                        className="btn-base btn-ghost btn-icon touch-target disabled:opacity-40"
                      >
                        <Plus size={18} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <textarea
              rows={2}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="input-base mt-4 w-full resize-y py-3 text-base"
            />

            <button
              type="button"
              disabled={submitting || !hasCounts}
              onClick={submit}
              className="btn-base btn-primary mt-4 w-full py-3 text-base disabled:opacity-50"
            >
              {submitting ? t("saving") : t("save")}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className={cn("mt-4 text-sm text-[var(--color-error-ink)]")}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
