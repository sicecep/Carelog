"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { recipientApi, APIError } from "@/lib/api-client";

interface SummarySheetProps {
  open: boolean;
  onClose: () => void;
  recipientId: string;
  workspaceId: string;
  onLogged?: () => void;
}

export function SummarySheet({ open, onClose, recipientId, workspaceId, onLogged }: SummarySheetProps) {
  const t = useTranslations("summarysheet");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitSummary = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      // LOG-004.5: a quick summary is stored as a "note" entry tagged as a
      // summary, so the parent view can label it "Ringkasan". There is no
      // "summary" LogCategory — the report itself carries report_type.
      await recipientApi.createEntry(workspaceId, recipientId, {
        category: "note",
        value_text: t("summaryPrefix"),
        occurred_at: new Date().toISOString(),
      });
      onLogged?.();
      onClose();
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }, [workspaceId, recipientId, onLogged, onClose, t]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-xl bg-[var(--color-surface)] p-5 shadow-lg sm:rounded-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-medium text-[var(--color-text)]">{t("title")}</h2>
        <p className="mb-6 text-base text-[var(--color-text-muted)]">{t("hint")}</p>

        {error && (
          <p role="alert" className="mb-3 text-sm text-[var(--color-error-ink)]">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submitSummary}
          disabled={submitting}
          className="btn-base btn-primary w-full py-4 text-base disabled:opacity-50"
        >
          {submitting ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}
