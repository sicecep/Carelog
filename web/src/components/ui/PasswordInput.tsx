"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeSlash } from "phosphor-react";

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  // "current-password" for sign-in, "new-password" for sign-up and changes,
  // so password managers fill or offer to generate correctly.
  autoComplete: "current-password" | "new-password";
  hint?: string;
  required?: boolean;
  name?: string;
}

/**
 * Password field with a show/hide toggle. Showing the password matters on a
 * phone keyboard, where a typo in a masked field is invisible until the
 * login fails.
 */
export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  required = true,
  name,
}: PasswordInputProps) {
  const t = useTranslations("auth");
  const id = useId();
  const hintId = `${id}-hint`;
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium text-[var(--color-text)]">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? hintId : undefined}
          className="input-base block w-full pr-14"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          className="btn-base btn-ghost btn-icon absolute inset-y-0 right-0 text-[var(--color-text-muted)]"
        >
          {visible ? <EyeSlash size={22} aria-hidden="true" /> : <Eye size={22} aria-hidden="true" />}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-[var(--color-text-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}
