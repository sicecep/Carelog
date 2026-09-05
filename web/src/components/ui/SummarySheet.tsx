"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Clipboard, Check, X } from "phosphor-react";
import { recipientApi, APIError, SummaryItem } from "@/lib/api-client";

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
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      const fetchSummary = async () => {
        try {
          const res = await recipientApi.getSummary(workspaceId, recipientId);
          if (res.data) setSummary(res.data);
        } catch (err) {
          setError(err instanceof APIError ? err.message : t("errorGeneric"));
        }
      };
      void fetchSummary();
    }
  }, [open, workspaceId, recipientId, t]);

  const copyToClipboard = useCallback(() => {
    const text = summary.map(item => `${item.category}: ${item.count}`).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [summary]);

  const submitSummary = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-medium text-[var(--color-text)]">{t("title")}</h2>
          <button type="button" onClick={onClose} className="btn-base btn-ghost btn-icon">
            <X size={20} />
          </button>
        </div>
        <p className="mb-6 text-base text-[var(--color-text-muted)]">{t("hint")}</p>

        {summary.length > 0 && (
          <div className="mb-6 bg-[var(--color-surface-hover)] p-3 rounded-lg text-sm text-[var(--color-text)]">
            {summary.map(item => (
              <p key={item.category}>{item.category}: {item.count}</p>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={copyToClipboard}
          className="btn-base btn-secondary w-full mb-3 flex items-center justify-center gap-2"
        >
          {copied ? <Check size={20} /> : <Clipboard size={20} />}
          {copied ? "Copied!" : "Copy Summary for WhatsApp"}
        </button>

        {error && <p role="alert" className="mb-3 text-sm text-[var(--color-error-ink)]">{error}</p>}

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
