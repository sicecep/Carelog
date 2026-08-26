"use client";

// Client component: logout is an event handler, which a Server Component can't own.

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { SignOut } from "phosphor-react";
import { authApi } from "@/lib/api-client";

export function LogoutButton() {
  const nav = useTranslations("nav");
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      // The API clears cl_access/cl_refresh via Set-Cookie; the web app holds no tokens.
      await authApi.logout();
    } catch (err) {
      // Even if revocation fails we still send the user to login — staying on a
      // dashboard they asked to leave is the worse outcome.
      console.error(err);
    }
    router.replace(`/${locale}/login`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      aria-busy={pending}
      className="btn-base btn-ghost touch-target text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    >
      <SignOut size={20} weight="thin" aria-hidden="true" />
      <span>{pending ? t("loggingOut") : nav("logout")}</span>
    </button>
  );
}
