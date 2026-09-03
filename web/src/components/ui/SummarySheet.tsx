"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, CheckCircle } from "phosphor-react";
import { recipientApi, APIError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
      // LOG-004.3: Submit a structured summary entry
      await recipientApi.createEntry(workspaceId, recipientId, {
        category: "summary",
        value_json: JSON.stringify({
            // This structure will be finalized based on the summary UI counts
            meals: 0, 
            sleep: 0,
            mood: "happy"
        }) as any,
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
        <h2 className="mb-4 text-xl font-medium">{t("title")}</h2>
        <p className="mb-6 text-base text-[var(--color-text-muted)]">{t("hint")}</p>
        
        {/* Placeholder for count-based UI (Meals 0-4+, Sleep duration chips, Mood scale) */}
        <div className="mb-6">
            <p className="text-sm font-medium text-[var(--color-text)]">Count-based UI goes here</p>
        </div>

        <button
          onClick={submitSummary}
          disabled={submitting}
          className="btn-base btn-primary w-full py-4 text-base"
        >
          {submitting ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}
