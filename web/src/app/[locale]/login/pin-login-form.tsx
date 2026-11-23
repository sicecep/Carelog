"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authApi, APIError } from "@/lib/api-client";
import { PinPad } from "@/components/ui/PinPad";
import { hardNavigate } from "@/lib/hard-navigate";

type Step = "identifier" | "pin" | "forgot-sent";

/**
 * Caregiver sign-in: phone number or username, then PIN (AUTH-005, login
 * revamp D3). Works from any device (D4); a device not seen before is
 * remembered by the API and the owner is told.
 *
 * Two steps rather than one screen because the PIN pad needs the full
 * viewport on a small phone, and because the identifier is usually
 * remembered by the browser while the PIN never is.
 */
export function PinLoginForm() {
  const t = useTranslations("pin");
  const locale = useLocale();

  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submitIdentifier(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Shortest valid username is 3 characters; the API decides the rest.
    if (identifier.trim().length < 3) {
      setError(t("identifierInvalid"));
      return;
    }
    setError(null);
    setStep("pin");
  }

  async function submitPin(pin: string) {
    setBusy(true);
    setError(null);
    try {
      await authApi.pinLogin(identifier.trim(), pin);
      // Full document navigation, NOT router.push. The API just set the
      // session cookies on this response; a client-side transition would
      // reuse the already-rendered server tree, which was built without
      // them, and the dashboard would bounce straight back to /login.
      hardNavigate(`/${locale}/dashboard`);
    } catch (err) {
      // The API deliberately does not distinguish a wrong PIN from an
      // unknown account, so the copy can't either. Only the lock is
      // distinguishable, because it changes what the caregiver should do.
      const code = err instanceof APIError ? err.code : "";
      setError(code === "pin_locked" ? t("locked") : t("incorrect"));
      setBusy(false);
    }
  }

  async function requestReset() {
    setBusy(true);
    try {
      await authApi.forgotPIN(identifier.trim());
      setStep("forgot-sent");
    } catch {
      // Even a failure here must not reveal anything about the account.
      setStep("forgot-sent");
    } finally {
      setBusy(false);
    }
  }

  if (step === "forgot-sent") {
    return (
      <div className="space-y-6 text-center">
        <p
          role="status"
          className="rounded-md border border-[var(--color-success)] bg-[var(--color-success-soft)] px-4 py-4 text-base text-[var(--color-success-ink)]"
        >
          {t("resetRequested")}
        </p>
        <button
          type="button"
          onClick={() => {
            setStep("identifier");
            setError(null);
          }}
          className="btn-base w-full border border-[var(--color-border-control)] bg-[var(--color-surface)] text-[var(--color-text)]"
        >
          {t("back")}
        </button>
      </div>
    );
  }

  if (step === "pin") {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[var(--color-text)]">{t("enterPin")}</h2>
          <p className="mt-1 text-base text-[var(--color-text-muted)]">{identifier.trim()}</p>
        </div>

        <PinPad onComplete={submitPin} disabled={busy} error={error} />

        <div className="space-y-3">
          <button
            type="button"
            onClick={requestReset}
            disabled={busy}
            className="touch-target w-full text-base text-[var(--color-accent-hover)] underline"
          >
            {t("forgotPin")}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("identifier");
              setError(null);
            }}
            disabled={busy}
            className="touch-target w-full text-base text-[var(--color-text-muted)]"
          >
            {t("changeNumber")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitIdentifier} className="space-y-6">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-soft)] px-4 py-3 text-base text-[var(--color-error-ink)]"
        >
          {error}
        </p>
      )}

      <div>
        <label htmlFor="caregiver-identifier" className="block text-base font-medium text-[var(--color-text)]">
          {t("identifierLabel")}
        </label>
        {/* One field for a phone number or a username (spec §7), so the
            keyboard stays plain text: a username needs letters. The server
            decides which it is. */}
        <input
          id="caregiver-identifier"
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
          className="input-base mt-2 w-full"
        />
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t("identifierHint")}</p>
      </div>

      <button type="submit" className="btn-base w-full bg-[var(--color-accent)] text-[var(--color-text-inverse)]">
        {t("continue")}
      </button>
    </form>
  );
}
