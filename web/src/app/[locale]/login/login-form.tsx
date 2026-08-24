"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { authApi } from "@/lib/api-client";

type Status = "idle" | "loading" | "sent" | "error";

export function LoginForm() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");

    try {
      await authApi.requestMagicLink(email);
      setSentTo(email);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <p
        role="status"
        className="rounded-md border border-green-200 bg-green-50 px-4 py-4 text-base text-green-900"
      >
        {t("magicLinkSent", { email: sentTo })}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {status === "error" && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700"
        >
          {t("magicLinkError")}
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-base font-medium text-gray-700">
          {t("email")}
        </label>
        {/* h-12 (48px) and text-base (16px) are deliberate: large tap target, and
            >=16px stops iOS Safari zooming in on focus. */}
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          className="mt-1 block h-12 w-full rounded-md border border-gray-300 px-3 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <button
        type="submit"
        disabled={status === "loading"}
        className="flex h-12 w-full items-center justify-center rounded-md bg-blue-600 px-4 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? t("sendingMagicLink") : t("sendMagicLink")}
      </button>
    </form>
  );
}
