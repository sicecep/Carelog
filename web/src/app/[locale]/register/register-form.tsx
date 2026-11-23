"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { authApi, APIError } from "@/lib/api-client";
import { PasswordInput } from "@/components/ui/PasswordInput";

const PASSWORD_MIN = 8;

/**
 * Owner self-registration with email and/or phone + password (login revamp
 * D1, spec §4.1). The account starts pending approval. The success message
 * is the same whether or not the email/phone was already registered, so the
 * form can't be used to discover accounts.
 */
export function RegisterForm() {
  const t = useTranslations("register");
  const locale = useLocale();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function clientError(): string | null {
    if (email.trim() === "" && phone.trim() === "") return t("errNeedIdentity");
    if ([...password].length < PASSWORD_MIN) return t("errPasswordShort");
    if (password !== confirm) return t("errPasswordMismatch");
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const local = clientError();
    if (local) {
      setError(local);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.register({
        full_name: fullName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password,
        locale,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof APIError) {
        if (err.code === "password_too_common") setError(t("errPasswordCommon"));
        else if (err.code === "password_invalid") setError(t("errPasswordShort"));
        else if (err.code === "rate_limited") setError(t("errRateLimited"));
        else setError(t("error"));
      } else {
        setError(t("error"));
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="space-y-4 rounded-md border border-[var(--color-success)] bg-[var(--color-success-soft)] px-4 py-4 text-[var(--color-success-ink)]"
      >
        <p className="text-lg font-semibold">{t("successTitle")}</p>
        <p className="text-base">{t("success")}</p>
        <Link href={`/${locale}/login?role=owner`} className="btn-base btn-primary touch-target w-full">
          {t("signIn")}
        </Link>
      </div>
    );
  }

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
        <label htmlFor="reg-name" className="block text-base font-medium text-[var(--color-text)]">
          {t("fullNameLabel")}
        </label>
        <input
          id="reg-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={100}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t("fullNamePlaceholder")}
          className="input-base mt-1 block w-full"
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm text-[var(--color-text-muted)]">{t("identityHint")}</legend>
        <div>
          <label htmlFor="reg-email" className="block text-base font-medium text-[var(--color-text)]">
            {t("emailLabel")}
          </label>
          <input
            id="reg-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="input-base mt-1 block w-full"
          />
        </div>
        <div>
          <label htmlFor="reg-phone" className="block text-base font-medium text-[var(--color-text)]">
            {t("phoneLabel")}
          </label>
          <input
            id="reg-phone"
            name="tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("phonePlaceholder")}
            className="input-base mt-1 block w-full"
          />
        </div>
      </fieldset>

      <PasswordInput
        label={t("passwordLabel")}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={t("passwordHint")}
        name="new-password"
      />
      <PasswordInput
        label={t("confirmPasswordLabel")}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        name="confirm-password"
      />

      <button
        type="submit"
        disabled={busy || fullName.trim() === ""}
        className="btn-base btn-primary touch-target w-full disabled:opacity-50"
      >
        {busy ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
