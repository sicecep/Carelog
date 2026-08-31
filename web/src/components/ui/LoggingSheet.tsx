"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, CheckCircle, Clock } from "phosphor-react";
import { cn } from "@/lib/utils";
import { type LogCategory } from "@/lib/constants.generated";
import { LOG_SUBCATEGORIES, type LogSubcategory } from "@/lib/log-subcategories";
import { recipientApi, APIError } from "@/lib/api-client";
import { CategoryGrid } from "./CategoryGrid";

interface LoggingSheetProps {
  /** Whether the sheet is open. Controlled by the parent (e.g. a FAB). */
  open: boolean;
  onClose: () => void;
  recipientId: string;
  workspaceId: string;
  /** Called after a successful save so the parent can refresh a timeline, etc. */
  onLogged?: () => void;
}

type Step = "category" | "subcategory";

/**
 * Bottom sheet driving the "zero-typing" quick-tap logging flow (LOG-002):
 * 1. Caregiver taps a category (Meal, Meds, Sleep, ...).
 * 2. Sheet reveals subcategory chips for that category (if any exist).
 * 3. Tapping a chip immediately POSTs the entry with occurred_at = now().
 *
 * Attribution (contributor id/name/role) is derived server-side from the
 * session cookie — this component never sends a contributor field.
 */
export function LoggingSheet({ open, onClose, recipientId, workspaceId, onLogged }: LoggingSheetProps) {
  const t = useTranslations("logging");
  const tCategories = useTranslations("reports.categories");
  const tSubcategories = useTranslations("logging.subcategories");

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<LogCategory | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null); // subcategory id being submitted
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("category");
    setCategory(null);
    setSubmitting(null);
    setSuccess(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const submitEntry = useCallback(
    async (cat: LogCategory, sub: LogSubcategory | undefined) => {
      setSubmitting(sub ?? "__none__");
      setError(null);
      try {
        // occurred_at is auto-filled to NOW() — zero typing means zero manual
        // timestamp entry too. Attribution (contributor) is handled entirely
        // server-side via the session cookie; we never send it here.
        await recipientApi.createEntry(workspaceId, recipientId, {
          category: cat,
          subcategory: sub,
          occurred_at: new Date().toISOString(),
        });
        setSuccess(true);
        onLogged?.();
        setTimeout(() => {
          handleClose();
        }, 1200);
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      } finally {
        setSubmitting(null);
      }
    },
    [workspaceId, recipientId, onLogged, handleClose, t]
  );

  const handleCategorySelect = useCallback((cat: LogCategory) => {
    setCategory(cat);
    setError(null);
    const subs = LOG_SUBCATEGORIES[cat] ?? [];
    if (subs.length === 0) {
      // No sub-classification for this category (e.g. Notes) — log immediately.
      void submitEntry(cat, undefined);
    } else {
      setStep("subcategory");
    }
  }, [submitEntry]);

  if (!open) return null;

  const subcategories = category ? LOG_SUBCATEGORIES[category] ?? [] : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logging-sheet-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-t-xl bg-[var(--color-surface)] p-5 shadow-lg sm:rounded-xl sm:p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="logging-sheet-title" className="text-xl font-medium text-[var(--color-text)]">
            {step === "category" ? t("title") : tCategories(category!)}
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
            <span>{t("logged")}</span>
          </div>
        ) : step === "category" ? (
          <CategoryGrid onSelect={handleCategorySelect} />
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setStep("category")}
              className="mb-4 text-sm font-medium text-[var(--color-accent)] touch-target"
            >
              {t("back")}
            </button>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {subcategories.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => category && submitEntry(category, sub as LogSubcategory)}
                  className={cn(
                    "chip touch-target flex min-h-[56px] items-center justify-center rounded-lg border-2 border-[var(--color-border)] px-3 py-3 text-base font-medium transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]",
                    submitting === sub && "opacity-60"
                  )}
                >
                  {tSubcategories(`${category}.${sub}` as const)}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--color-error-ink)]">
            {error}
          </p>
        )}

        <p className="mt-4 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <Clock size={14} aria-hidden="true" />
          {t("autoTimestampHint")}
        </p>
      </div>
    </div>
  );
}
