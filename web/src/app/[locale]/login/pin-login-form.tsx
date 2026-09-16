"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authApi, APIError } from "@/lib/api-client";
import { PinPad } from "@/components/ui/PinPad";

type Step = "phone" | "pin" | "forgot-sent";

/**
 * Caregiver sign-in: phone number, then PIN (AUTH-005).
 *
 * Two steps rather than one screen because the PIN pad needs the full
 * viewport on a small phone, and because the phone number is usually
 * remembered by the browser while the PIN never is.
 */
export function PinLoginForm() {
  const t = useTranslations("pin");
  const locale = useLocale();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submitPhone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phone.trim().length < 6) {
      setError(t("phoneInvalid"));
      return;
    }
    setError(null);
    setStep("pin");
  }

  async function submitPin(pin: string) {
    setBusy(true);
    setError(null);
    try {
      await authApi.pinLogin(phone, pin);
      // Full document navigation, NOT router.push. The API just set the
      // session cookies on this response; a client-side transition would
      // reuse the already-rendered server tree, which was built without
      // them, and the dashboard would bounce straight back to /login.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above: must re-run server components with the new cookies
      window.location.href = `/${locale}/dashboard`;
    } catch (err) {
      // The API deliberately does not distinguish a wrong PIN from an
      // unknown number, so the copy can't either. device_not_trusted IS
      // distinguishable and actionable, so it gets its own message.
      const code = err instanceof APIError ? err.code : "";
      if (code === "device_not_trusted") {
        setError(t("deviceNotTrusted"));
      } else if (code === "pin_locked") {
        setError(t("locked"));
      } else if (code === "pin_not_set") {
        setError(t("notEnrolled"));
      } else {
        setError(t("incorrect"));
      }
      setBusy(false);
    }
  }

  async function requestReset() {
    setBusy(true);
    try {
      await authApi.forgotPIN(phone);
      setStep("forgot-sent");
    } catch {
      // Even a failure here must not reveal anything about the number.
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
          className="rounded-md border border-green-200 bg-green-50 px-4 py-4 text-base text-green-900"
        >
          {t("resetRequested")}
        </p>
        <button
          type="button"
          onClick={() => {
            setStep("phone");
            setError(null);
          }}
          className="btn-base w-full border border-gray-300 bg-white text-gray-900"
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
          <h2 className="text-xl font-semibold text-gray-900">{t("enterPin")}</h2>
          <p className="mt-1 text-base text-gray-600">{phone}</p>
        </div>

        <PinPad onComplete={submitPin} disabled={busy} error={error} />

        <div className="space-y-3">
          <button
            type="button"
            onClick={requestReset}
            disabled={busy}
            className="touch-target w-full text-base text-blue-700 underline"
          >
            {t("forgotPin")}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
            disabled={busy}
            className="touch-target w-full text-base text-gray-600"
          >
            {t("changeNumber")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitPhone} className="space-y-6">
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
          {t("phoneLabel")}
        </label>
        {/* inputMode=tel gives the dialer keypad without the strict
            validation of type=tel, which rejects the spaces and dashes
            people naturally type. The server normalizes anyway. */}
        <input
          id="phone"
          name="phone"
          type="text"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t("phonePlaceholder")}
          className="input-base mt-2 w-full"
        />
        <p className="mt-2 text-sm text-gray-500">{t("phoneHint")}</p>
      </div>

      <button type="submit" className="btn-base w-full bg-blue-600 text-white">
        {t("continue")}
      </button>
    </form>
  );
}
