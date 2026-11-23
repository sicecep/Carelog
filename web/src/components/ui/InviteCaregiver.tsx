"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { WhatsappLogo, UserPlus, X } from "phosphor-react";
import { invitationApi, APIError } from "@/lib/api-client";

interface InviteCaregiverProps {
  workspaceId: string;
}

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

// Wait for a pause in typing before asking the API, so a name typed quickly
// costs one request instead of one per key.
const USERNAME_CHECK_DELAY_MS = 400;
const USERNAME_MAX = 30;

// Mirrors the server rule (domain.NormalizeUsername) closely enough to skip
// a request for names that cannot pass; the server stays the authority.
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;

/**
 * Suggests a username from the caregiver's name: "Mbak Yuni" -> "mbak.yuni".
 * Accents are dropped and anything outside [a-z0-9] becomes a dot.
 */
function suggestUsername(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, USERNAME_MAX)
    .replace(/\.+$/g, "");
  return USERNAME_PATTERN.test(slug) && /[a-z]/.test(slug) ? slug : "";
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
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setPhone("");
    setUsername("");
    setUsernameStatus("idle");
    if (checkTimer.current) clearTimeout(checkTimer.current);
    setError(null);
    setWhatsappUrl(null);
  }, []);

  // Live availability check (spec §5.2), debounced. Called from the change
  // handler rather than an effect so each keystroke schedules exactly one
  // check and a stale answer can be ignored.
  const changeUsername = useCallback(
    (raw: string) => {
      const value = raw.trim().toLowerCase();
      setUsername(raw);
      if (checkTimer.current) clearTimeout(checkTimer.current);
      if (value === "") {
        setUsernameStatus("idle");
        return;
      }
      if (!USERNAME_PATTERN.test(value) || !/[a-z]/.test(value)) {
        setUsernameStatus("invalid");
        return;
      }
      setUsernameStatus("checking");
      checkTimer.current = setTimeout(async () => {
        try {
          const res = await invitationApi.usernameAvailable(workspaceId, value);
          setUsernameStatus(res.data?.available ? "available" : "taken");
        } catch (err) {
          // username_invalid covers the reserved names the pattern lets by.
          setUsernameStatus(
            err instanceof APIError && err.code === "username_invalid" ? "invalid" : "idle"
          );
        }
      }, USERNAME_CHECK_DELAY_MS);
    },
    [workspaceId]
  );

  const suggestion = username.trim() === "" ? suggestUsername(name) : "";
  const hasIdentifier = phone.trim() !== "" || username.trim() !== "";

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
        phone: phone.trim() || undefined,
        username: username.trim().toLowerCase() || undefined,
      });
      if (res.data?.whatsapp_url) {
        setWhatsappUrl(res.data.whatsapp_url);
      }
    } catch (err) {
      if (err instanceof APIError && err.code === "username_taken") {
        setUsernameStatus("taken");
      } else if (err instanceof APIError && err.code === "username_invalid") {
        setUsernameStatus("invalid");
      } else {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      }
    } finally {
      setSubmitting(false);
    }
  }, [workspaceId, name, phone, username, t]);

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--color-overlay)] sm:items-center"
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
              className="flex min-h-[56px] items-center justify-center gap-2 rounded-md bg-[var(--color-whatsapp)] px-4 py-3 text-base font-semibold text-[var(--color-whatsapp-ink)] hover:bg-[var(--color-whatsapp-hover)]"
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

            <div>
              <label htmlFor="invite-username" className="mb-1 block text-sm font-semibold text-[var(--color-text)]">
                {t("usernameLabel")}
              </label>
              <input
                id="invite-username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => changeUsername(e.target.value)}
                placeholder={t("usernamePlaceholder")}
                maxLength={USERNAME_MAX}
                aria-describedby="invite-username-hint invite-username-status"
                className="input-base w-full"
              />
              {suggestion && (
                <button
                  type="button"
                  onClick={() => changeUsername(suggestion)}
                  className="btn-base btn-ghost touch-target mt-1 px-2 text-sm text-[var(--color-accent)]"
                >
                  {t("usernameSuggest", { username: suggestion })}
                </button>
              )}
              <p id="invite-username-status" aria-live="polite" className="mt-1 text-sm">
                {usernameStatus === "checking" && (
                  <span className="text-[var(--color-text-muted)]">{t("usernameChecking")}</span>
                )}
                {usernameStatus === "available" && (
                  <span className="text-[var(--color-success-ink)]">{t("usernameAvailable")}</span>
                )}
                {usernameStatus === "taken" && (
                  <span className="text-[var(--color-error-ink)]">{t("usernameTaken")}</span>
                )}
                {usernameStatus === "invalid" && (
                  <span className="text-[var(--color-error-ink)]">{t("usernameInvalid")}</span>
                )}
              </p>
              <p id="invite-username-hint" className="mt-1 text-xs text-[var(--color-text-muted)]">
                {t("usernameHint")}
              </p>
            </div>

            {!hasIdentifier && name.trim() !== "" && (
              <p className="text-sm text-[var(--color-text-muted)]">{t("needIdentifier")}</p>
            )}

            {error && (
              <p role="alert" className="text-sm text-[var(--color-error-ink)]">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                submitting ||
                name.trim().length === 0 ||
                !hasIdentifier ||
                usernameStatus === "checking" ||
                usernameStatus === "taken" ||
                usernameStatus === "invalid"
              }
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
