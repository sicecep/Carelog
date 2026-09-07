"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, PencilSimple } from "phosphor-react";
import { recipientApi, APIError, Recipient } from "@/lib/api-client";

interface EditRecipientSheetProps {
  open: boolean;
  onClose: () => void;
  recipient: Recipient;
  workspaceId: string;
  onUpdated: (updated: Recipient) => void;
}

export function EditRecipientSheet({ open, onClose, recipient, workspaceId, onUpdated }: EditRecipientSheetProps) {
  const t = useTranslations("recipients");
  const [fullName, setFullName] = useState(recipient.full_name);
  const [displayName, setDisplayName] = useState(recipient.display_name || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await recipientApi.update(workspaceId, recipient.id, {
        full_name: fullName.trim(),
        display_name: displayName.trim() || undefined,
      });
      if (res.data) onUpdated(res.data);
      onClose();
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("detailLoadError"));
    } finally {
      setSubmitting(false);
    }
  }, [workspaceId, recipient.id, fullName, displayName, onUpdated, onClose, t]);

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
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-medium text-[var(--color-text)]">Edit Profile</h2>
          <button type="button" onClick={onClose} className="btn-base btn-ghost btn-icon">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-[var(--color-text)]">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input-base w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-[var(--color-text)]">Display Name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input-base w-full"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-[var(--color-error-ink)]">{error}</p>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-base btn-primary mt-6 w-full py-4 text-base"
        >
          {submitting ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
