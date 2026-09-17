"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { invitationApi, authApi, APIError } from "@/lib/api-client";
import { PinPad } from "@/components/ui/PinPad";

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
 * account created, device enrolled, signed in.
 */
export default function InviteClaimPage() {
  const t = useTranslations("invite");
  const tPin = useTranslations("pin");
  const locale = useLocale();
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [workspaceName, setWorkspaceName] = useState("");
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
    if (phone.trim().length < 6) {
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
      await authApi.claimInviteWithPIN(token, phone, pin, locale);
      // Full document navigation, NOT router.push — the claim response set
      // the session and device cookies, and server components must re-render
      // with them or the dashboard bounces back to /login.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above: must re-run server components with the new cookies
      window.location.href = `/${locale}/dashboard`;
    } catch (err) {
      const code = err instanceof APIError ? err.code : "";
      const message = err instanceof APIError ? err.message : "";
      if (code === "invite_invalid") {
        setStep("invalid");
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
        <p className="text-base text-gray-600">{t("loading")}</p>
      </div>
    );
  }

  if (step === "invalid") {
    return (
      <div className="mx-auto mt-20 max-w-md px-4">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-4">
          <h1 className="text-lg font-semibold text-red-900">{t("invalidTitle")}</h1>
          <p className="mt-2 text-base text-red-800">{t("invalidBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4 pb-16">
      <h1 className="text-center text-xl font-bold text-gray-900">
        {workspaceName ? t("titleNamed", { workspace: workspaceName }) : t("title")}
      </h1>

      {step === "phone" && (
        <form onSubmit={submitPhone} className="mt-8 space-y-6">
          <p className="text-base text-gray-600">{t("phoneIntro")}</p>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700"
            >
              {error}
            </p>
          )}

          <div>
            <label htmlFor="phone" className="block text-base font-medium text-gray-700">
              {tPin("phoneLabel")}
            </label>
            <input
              id="phone"
              name="phone"
              type="text"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={tPin("phonePlaceholder")}
              className="input-base mt-2 w-full"
            />
            <p className="mt-2 text-sm text-gray-500">{tPin("phoneHint")}</p>
          </div>

          <button type="submit" className="btn-base w-full bg-blue-600 text-white">
            {tPin("continue")}
          </button>
        </form>
      )}

      {step === "pin" && (
        <div className="mt-8 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900">{tPin("choosePin")}</h2>
            <p className="mt-1 text-base text-gray-600">{tPin("choosePinHint")}</p>
          </div>
          <PinPad onComplete={choosePin} disabled={busy} error={error} />
        </div>
      )}

      {step === "confirm" && (
        <div className="mt-8 space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900">{tPin("confirmPin")}</h2>
            <p className="mt-1 text-base text-gray-600">{tPin("confirmPinHint")}</p>
          </div>
          <PinPad onComplete={confirmPin} disabled={busy} error={error} />
        </div>
      )}
    </div>
  );
}
