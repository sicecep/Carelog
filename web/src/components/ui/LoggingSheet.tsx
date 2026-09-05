"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { X, CheckCircle, Clock } from "phosphor-react";
import { cn } from "@/lib/utils";
import { type LogCategory } from "@/lib/constants.generated";
import { LOG_SUBCATEGORIES, type LogSubcategory } from "@/lib/log-subcategories";
import { recipientApi, APIError } from "@/lib/api-client";
import { CategoryGrid } from "./CategoryGrid";
import { buildBackfillOptions, type BackfillOption } from "@/lib/backfill";

interface LoggingSheetProps {
  /** Whether the sheet is open. Controlled by the parent (e.g. a FAB). */
  open: boolean;
  onClose: () => void;
  recipientId: string;
  workspaceId: string;
  /** Called after a successful save so the parent can refresh a timeline, etc. */
  onLogged?: () => void;
}

type Step = "category" | "subcategory" | "backfill";

const NOTE_MAX = 500;

export function LoggingSheet({ open, onClose, recipientId, workspaceId, onLogged }: LoggingSheetProps) {
  const t = useTranslations("logging");
  const tCategories = useTranslations("reports.categories");
  const tSubcategories = useTranslations("logging.subcategories");

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<LogCategory | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [occurredAt, setOccurredAt] = useState<Date | undefined>(undefined);
  const [backfillMode, setBackfillMode] = useState(false);
  const [pendingSub, setPendingSub] = useState<LogSubcategory | undefined>(undefined);

  const backfillOptions = useMemo(() => buildBackfillOptions(), []);

  const reset = useCallback(() => {
    setStep("category");
    setCategory(null);
    setSubmitting(null);
    setSuccess(false);
    setError(null);
    setNoteText("");
    setOccurredAt(undefined);
    setBackfillMode(false);
    setPendingSub(undefined);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const submitEntry = useCallback(
    async (cat: LogCategory, sub: LogSubcategory | undefined, text?: string, time?: Date) => {
      setSubmitting(sub ?? (text ? "__text__" : "__none__"));
      setError(null);
      try {
        await recipientApi.createEntry(workspaceId, recipientId, {
          category: cat,
          subcategory: sub,
          value_text: text,
          occurred_at: (time ?? occurredAt ?? new Date()).toISOString(),
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
    [workspaceId, recipientId, onLogged, handleClose, t, occurredAt]
  );

  const handleCategorySelect = useCallback((cat: LogCategory) => {
    setCategory(cat);
    setError(null);
    const subs = LOG_SUBCATEGORIES[cat] ?? [];
    if (cat === "note") {
      setStep("subcategory");
    } else if (subs.length === 0) {
      if (backfillMode) {
        setPendingSub(undefined);
        setStep("backfill");
      } else {
        void submitEntry(cat, undefined);
      }
    } else {
      setStep("subcategory");
    }
  }, [backfillMode, submitEntry]);

  const handleSubSelect = useCallback((sub: LogSubcategory) => {
    if (backfillMode) {
      setPendingSub(sub);
      setStep("backfill");
    } else {
      if (category) void submitEntry(category, sub);
    }
  }, [category, backfillMode, submitEntry]);

  const handleBackfillSelect = useCallback((opt: BackfillOption) => {
    if (!category) return;
    void submitEntry(category, pendingSub, category === "note" ? noteText : undefined, opt.date);
  }, [category, pendingSub, noteText, submitEntry]);

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
        ) : step === "backfill" ? (
          <div>
            <button
              type="button"
              onClick={() => setStep(category === "note" || subcategories.length > 0 ? "subcategory" : "category")}
              className="mb-4 text-base font-semibold text-[var(--color-accent)] touch-target"
            >
              {t("back")}
            </button>

            {backfillOptions.blocks.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
                  {t("backfillBlocksLabel")}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {backfillOptions.blocks.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => handleBackfillSelect(opt)}
                      className="touch-target flex min-h-[56px] w-full items-center justify-center rounded-lg border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-3 text-base font-semibold text-[var(--color-text)] transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                    >
                      {t(`backfillBlocks.${opt.key}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
              {t("backfillSlotsLabel")}
            </p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {backfillOptions.slots.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => handleBackfillSelect(opt)}
                  className="touch-target flex min-h-[56px] w-full items-center justify-center rounded-lg border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-3 text-base font-semibold tabular-nums text-[var(--color-text)] transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : category === "note" ? (
          <div>
            <button
              type="button"
              onClick={() => setStep("category")}
              className="mb-4 text-sm font-medium text-[var(--color-accent)] touch-target"
            >
              {t("back")}
            </button>

            <textarea
              autoFocus
              rows={4}
              maxLength={NOTE_MAX}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="input-base w-full resize-y py-3 text-base"
            />
            <p className="mt-1 text-right text-xs text-[var(--color-text-muted)]">
              {noteText.length}/{NOTE_MAX}
            </p>

            <div className="mt-3 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setBackfillMode(!backfillMode)}
                className={cn(
                  "flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all touch-target",
                  backfillMode ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                )}
              >
                {t("backfillToggle")}
              </button>
              <button
                type="button"
                disabled={submitting !== null || noteText.trim().length === 0}
                onClick={() => {
                  if (backfillMode) {
                    setStep("backfill");
                  } else {
                    void submitEntry("note", undefined, noteText.trim());
                  }
                }}
                className="btn-base btn-primary flex-[2] py-3 text-base disabled:opacity-50"
              >
                {submitting !== null ? t("noteSaving") : t("noteSave")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep("category")}
                className="text-sm font-medium text-[var(--color-accent)] touch-target"
              >
                {t("back")}
              </button>
              <button
                type="button"
                onClick={() => setBackfillMode(!backfillMode)}
                className={cn(
                  "rounded-full border-2 px-3 py-1 text-xs font-medium transition-all touch-target",
                  backfillMode ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                )}
              >
                {t("backfillToggle")}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {subcategories.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => handleSubSelect(sub as LogSubcategory)}
                  className={cn(
                    "touch-target flex min-h-[56px] w-full items-center justify-center rounded-lg border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-3 text-base font-semibold text-[var(--color-text)] transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50",
                    submitting === sub && "opacity-60"
                  )}
                >
                  {tSubcategories(`${category}.${sub}` as const)}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-[var(--color-error-ink)]">{error}</p>}

        <p className="mt-4 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <Clock size={14} aria-hidden="true" />
          {backfillMode ? t("backfillHint") : t("autoTimestampHint")}
        </p>
      </div>
    </div>
  );
}
