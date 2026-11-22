"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { WhatsappLogo } from "phosphor-react";
import { authApi, APIError } from "@/lib/api-client";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { hardNavigate } from "@/lib/hard-navigate";

interface OwnerLoginFormProps {
  // Digits-only WhatsApp number of the platform owner (SUPPORT_WHATSAPP),
  // or undefined when not configured.
  supportWhatsApp?: string;
}

/**
 * Owner/parent sign-in: email or phone + password (login revamp D1).
 * Error copy never says which part was wrong, matching the API.
 */
export function OwnerLoginForm({ supportWhatsApp }: OwnerLoginFormProps) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.passwordLogin(identifier.trim(), password);
      const result = res.data;
      if (!result) throw new Error("empty response");
      // Full document navigation, NOT router.push: the API just set the
      // session cookies, and the next page must render on the server with
      // them (same reasoning as the PIN form).
      if (result.status === "pending" || result.status === "rejected") {
        hardNavigate(`/${locale}/pending?status=${result.status}`);
        return;
      }
      if (result.password_change_required) {
        hardNavigate(`/${locale}/change-password`);
        return;
      }
      hardNavigate(`/${locale}${result.next ?? "/dashboard"}`);
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  function messageFor(err: unknown): string {
    if (err instanceof APIError) {
      switch (err.code) {
        case "invalid_credentials":
          return t("errInvalidCredentials");
        case "account_locked":
          return t("errAccountLocked");
        case "rate_limited":
          return t("errRateLimited");
        case "account_disabled":
          return t("errAccountDisabled");
      }
    }
    return t("errGeneric");
  }

  const waHref = supportWhatsApp
    ? `https://wa.me/${supportWhatsApp}?text=${encodeURIComponent(
        t("forgotPasswordMessage", { identifier: identifier.trim() || "-" })
      )}`
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-soft)] px-4 py-3 text-base text-[var(--color-error-ink)]"
        >
          {error}
        </p>
      )}

      <div>
        <label htmlFor="owner-identifier" className="block text-base font-medium text-[var(--color-text)]">
          {t("identifierLabel")}
        </label>
        <input
          id="owner-identifier"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={t("identifierPlaceholder")}
          className="input-base mt-1 block w-full"
        />
      </div>

      <PasswordInput
        label={t("passwordLabel")}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        name="password"
      />

      <button
        type="submit"
        disabled={busy || identifier.trim() === "" || password === ""}
        className="btn-base btn-primary touch-target w-full disabled:opacity-50"
      >
        {busy ? t("signingIn") : t("signInButton")}
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={() => setShowForgot((v) => !v)}
          aria-expanded={showForgot}
          className="btn-base btn-ghost touch-target text-base font-medium text-[var(--color-accent)]"
        >
          {t("forgotPassword")}
        </button>
        {showForgot && (
          <div className="mt-2 space-y-3 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-hover)] p-4 text-left">
            <p className="text-base text-[var(--color-text)]">
              {waHref ? t("forgotPasswordHelp") : t("forgotPasswordNoContact")}
            </p>
            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-base touch-target flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-whatsapp)] font-semibold text-[var(--color-whatsapp-ink)] hover:bg-[var(--color-whatsapp-hover)]"
              >
                <WhatsappLogo size={22} weight="fill" aria-hidden="true" />
                {t("forgotPasswordWhatsApp")}
              </a>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
