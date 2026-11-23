"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { invitationApi, authApi, APIError } from "@/lib/api-client";
import { PinPad } from "@/components/ui/PinPad";
import { hardNavigate } from "@/lib/hard-navigate";

type Step = "loading" | "invalid" | "phone" | "pin" | "confirm";

/**
 * Invite claim for phone-primary caregivers (AUTH-005).
 *
 * This replaces the old session-gated claim: a caregiver with no email could
 * never reach it, because claiming required a session and the only way to get
 * one was a magic link. The invite token itself is now the credential — the
 * owner vouched for this person by sending it over their own WhatsApp.
 *
 * Flow: preview the invite -> confirm phone -> choose PIN -> confirm PIN ->
 * account created, device enrolled, signed in. When the owner picked a
 * username (login revamp §5.2) the page shows it and the phone is optional.
 */
export default function InviteClaimPage() {
  const t = useTranslations("invite");
  const tPin = useTranslations("pin");
  const locale = useLocale();
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [workspaceName, setWorkspaceName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Preview the invite before asking for anything: a revoked or expired link
  // should say so immediately, not after the caregiver has typed a PIN.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await invitationApi.get(token);
        if (cancelled) return;
        setWorkspaceName(res.data?.workspace_name ?? "");
        setUsername(res.data?.username ?? "");
        setStep("phone");
      } catch {
        if (!cancelled) setStep("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function submitPhone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const typed = phone.trim();
    // With a username on the invite the phone may be left empty.
    if ((typed !== "" || !username) && typed.length < 6) {
      setError(tPin("phoneInvalid"));
      return;
    }
    setError(null);
    setStep("pin");
  }

  // First PIN entry — hold it and ask again rather than enrolling straight
  // away. A mistyped PIN that nobody confirms locks the caregiver out of
  // their own account on the very first use.
  function choosePin(pin: string) {
    setFirstPin(pin);
    setError(null);
    setStep("confirm");
  }

  async function confirmPin(pin: string) {
    if (pin !== firstPin) {
      setError(tPin("mismatch"));
      setStep("pin");
      setFirstPin("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.claimInviteWithPIN(token, phone.trim(), pin, locale);
      // Full document navigation, NOT router.push — the claim response set
      // the session and device cookies, and server components must re-render
      // with them or the dashboard bounces back to /login.
      hardNavigate(`/${locale}/dashboard`);
    } catch (err) {
      const code = err instanceof APIError ? err.code : "";
      const message = err instanceof APIError ? err.message : "";
      if (code === "invitation_invalid") {
        setStep("invalid");
      } else if (code === "username_taken") {
        setError(t("usernameTaken"));
        setStep("phone");
        setFirstPin("");
      } else {
        // validation_error carries an actionable message (weak PIN, bad
        // phone) — show it rather than a generic failure.
        setError(message || t("errorClaiming"));
        setStep("pin");
        setFirstPin("");
      }
      setBusy(false);
    }
  }

  if (step === "loading") {
    return (
      <div className="mx-auto mt-20 max-w-md px-4 text-center">
        <p className="text-base text-[var(--color-text-muted)]">{t("loading")}</p>
      </div>
    );
  }

  if (step === "invalid") {
    return (
      <div className="mx-auto mt-20 max-w-md px-4">
        <div className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-soft)] px-4 py-4">
          <h1 className="text-lg font-semibold text-[var(--color-error-ink)]">{t("invalidTitle")}</h1>
          <p className="mt-2 text-base text-[var(--color-error-ink)]">{t("invalidBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4 pb-16">
      <h1 className="text-center text-xl font-bold text-[var(--color-text)]">
        {workspaceName ? t("titleNamed", { workspace: workspaceName }) : t("title")}
      </h1>

      {step === "phone" && (
        <form onSubmit={submitPhone} className="mt-8 space-y-6">
          {username && (
            <p className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-hover)] px-4 py-3 text-base text-[var(--color-text)]">
              {t("usernameIntro", { username })}
            </p>
          )}
          <p className="text-base text-[var(--color-text-muted)]">
            {username ? t("phoneIntroOptional") : t("phoneIntro")}
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-soft)] px-4 py-3 text-base text-[var(--color-error-ink)]"
            >
              {error}
            </p>
          )}

          <div>
            <label htmlFor="phone" className="block text-base font-medium text-[var(--color-text)]">
              {username ? t("phoneOptional") : tPin("phoneLabel")}
            </label>
            <input
              id="phone"
              name="phone"
              type="text"
              inputMode="tel"
              autoComplete="tel"
              required={!username}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={tPin("phonePlaceholder")}
              className="input-base mt-2 w-full"
            />
            {/* "The number your family used to invite you" is only true
                when they did not invite by username. */}
            {!username && (
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{tPin("phoneHint")}</p>
            )}
          </div>

          <button type="submit" className="btn-base w-full bg-[var(--color-accent)] text-[var(--color-text-inverse)]">
            {tPin("continue")}
          </button>
        </form>
      )}

      {step === "pin" && (
        <div className="mt-8 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">{tPin("choosePin")}</h2>
            <p className="mt-1 text-base text-[var(--color-text-muted)]">{tPin("choosePinHint")}</p>
          </div>
          <PinPad onComplete={choosePin} disabled={busy} error={error} />
        </div>
      )}

      {step === "confirm" && (
        <div className="mt-8 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">{tPin("confirmPin")}</h2>
            <p className="mt-1 text-base text-[var(--color-text-muted)]">{tPin("confirmPinHint")}</p>
          </div>
          <PinPad onComplete={confirmPin} disabled={busy} error={error} />
        </div>
      )}
    </div>
  );
}
