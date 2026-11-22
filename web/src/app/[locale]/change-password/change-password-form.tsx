"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { authApi, APIError } from "@/lib/api-client";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { hardNavigate } from "@/lib/hard-navigate";

const PASSWORD_MIN = 8;

interface ChangePasswordFormProps {
  // false for an owner who signed up by magic link before passwords
  // existed: there is no current password to confirm.
  hasPassword: boolean;
  // true right after an admin reset: the "current" password is the
  // temporary one the admin sent.
  required: boolean;
}

export function ChangePasswordForm({ hasPassword, required }: ChangePasswordFormProps) {
  const t = useTranslations("changePassword");
  const locale = useLocale();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if ([...next].length < PASSWORD_MIN) return setError(t("errShort"));
    if (next !== confirm) return setError(t("errMismatch"));
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(next, hasPassword ? current : undefined);
      toast.success(t("success"));
      // Full navigation so every server-rendered page re-reads the session
      // state (the temporary-password block is now lifted).
      hardNavigate(`/${locale}/dashboard`);
    } catch (err) {
      setBusy(false);
      if (err instanceof APIError) {
        switch (err.code) {
          case "invalid_credentials":
            return setError(t("errCurrentWrong"));
          case "account_locked":
            return setError(t("errLocked"));
          case "password_too_common":
            return setError(t("errCommon"));
          case "password_invalid":
            return setError(t("errShort"));
          case "validation_error":
            return setError(t("errSame"));
        }
      }
      setError(t("errGeneric"));
    }
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

      {hasPassword && (
        <PasswordInput
          label={required ? t("currentLabelTemp") : t("currentLabel")}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          name="current-password"
        />
      )}
      <PasswordInput
        label={t("newLabel")}
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        hint={t("newHint")}
        name="new-password"
      />
      <PasswordInput
        label={t("confirmLabel")}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        name="confirm-password"
      />

      <button
        type="submit"
        disabled={busy || (hasPassword && current === "") || next === ""}
        className="btn-base btn-primary touch-target w-full disabled:opacity-50"
      >
        {busy ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
