"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { WhatsappLogo, UserPlus, X } from "phosphor-react";
import { invitationApi, APIError } from "@/lib/api-client";

interface InviteCaregiverProps {
  workspaceId: string;
}

/**
 * WRK-004: owner-side invite flow. Deliberately NOT an email invite — per the
 * PRD, Indonesian ART/nannies are reached via WhatsApp, not email. The owner
 * fills in a name (+ optional phone for a direct deep link), we mint a
 * single-use token server-side, and hand back a wa.me link with the message
 * pre-filled so the owner just taps "send" in their own WhatsApp.
 */
export function InviteCaregiver({ workspaceId }: InviteCaregiverProps) {
  const t = useTranslations("invitecaregiver");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setPhone("");
    setError(null);
    setWhatsappUrl(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    setOpen(false);
  }, [reset]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await invitationApi.create(workspaceId, {
        invitee_name: name.trim(),
        role: "caregiver",
        whatsapp_phone: phone.trim() || undefined,
      });
      if (res.data?.whatsapp_link) {
        setWhatsappUrl(res.data.whatsapp_link);
      }
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }, [workspaceId, name, phone, t]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-base btn-secondary touch-target inline-flex items-center gap-2"
      >
        <UserPlus size={20} weight="bold" aria-hidden="true" />
        <span>{t("inviteButton")}</span>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-caregiver-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-t-xl bg-[var(--color-surface)] p-5 shadow-lg sm:rounded-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="invite-caregiver-title" className="text-xl font-medium text-[var(--color-text)]">
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

        {whatsappUrl ? (
          <div className="space-y-4">
            <p className="text-base text-[var(--color-text)]">{t("readyToSend")}</p>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[56px] items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-3 text-base font-semibold text-white hover:opacity-90"
            >
              <WhatsappLogo size={22} weight="fill" aria-hidden="true" />
              <span>{t("sendWhatsApp")}</span>
            </a>
            <p className="text-xs text-[var(--color-text-muted)]">{t("expiryHint")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="invite-name" className="mb-1 block text-sm font-semibold text-[var(--color-text)]">
                {t("nameLabel")}
              </label>
              <input
                id="invite-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={100}
                className="input-base w-full"
              />
            </div>

            <div>
              <label htmlFor="invite-phone" className="mb-1 block text-sm font-semibold text-[var(--color-text)]">
                {t("phoneLabel")}
              </label>
              <input
                id="invite-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("phonePlaceholder")}
                className="input-base w-full"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("phoneHint")}</p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-[var(--color-error-ink)]">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || name.trim().length === 0}
              className="btn-base btn-primary touch-target w-full py-3 text-base disabled:opacity-50"
            >
              {submitting ? t("generating") : t("generateLink")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
