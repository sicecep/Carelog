"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoginForm } from "./login-form";
import { PinLoginForm } from "./pin-login-form";

type Method = "pin" | "email";

/**
 * Chooses between the two sign-in methods (AUTH-005).
 *
 * PIN is first and default: caregivers are the majority of daily logins and
 * the persona least able to deal with an email inbox. Owners sign in far
 * less often and are comfortable finding the second tab.
 */
export function LoginMethodTabs() {
  const t = useTranslations("auth");
  const [method, setMethod] = useState<Method>("pin");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label={t("signInMethod")}
        className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={method === "pin"}
          onClick={() => setMethod("pin")}
          className={`touch-target rounded-md text-base font-medium transition-colors ${
            method === "pin" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
          }`}
        >
          {t("methodPin")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "email"}
          onClick={() => setMethod("email")}
          className={`touch-target rounded-md text-base font-medium transition-colors ${
            method === "email" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
          }`}
        >
          {t("methodEmail")}
        </button>
      </div>

      {method === "pin" ? <PinLoginForm /> : <LoginForm />}
    </div>
  );
}
