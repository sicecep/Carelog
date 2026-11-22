import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { authApi, APIError, type MeResponse } from "@/lib/api-client";
import { ChangePasswordForm } from "./change-password-form";

interface ChangePasswordPageProps {
  params: Promise<{ locale: string }>;
}

// Set or change the signed-in user's password (login revamp §4.3, §4.5).
// After an admin reset the API blocks the rest of the app until this is
// done (403 password_change_required), so this page must not depend on any
// workspace-scoped endpoint — only /auth/me, which stays reachable.
export default async function ChangePasswordPage({ params }: ChangePasswordPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changePassword" });

  const forwarded = { Cookie: (await cookies()).toString() };
  let me: MeResponse | null = null;
  let signedOut = false;
  try {
    const res = await authApi.me(undefined, forwarded);
    me = res.data;
  } catch (err) {
    if (err instanceof APIError && err.status === 401) signedOut = true;
    else throw err;
  }
  // redirect() throws NEXT_REDIRECT, so it runs outside the try/catch.
  if (signedOut || !me) redirect(`/${locale}/login`);

  const required = me.auth.password_change_required;
  const hasPassword = me.auth.has_password;
  const title = hasPassword ? t("titleChange") : t("titleSet");
  const intro = required ? t("introRequired") : hasPassword ? t("introChange") : t("introSet");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-hover)] px-4 py-8">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{title}</h1>
          <p
            className={
              required
                ? "mt-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-base text-[var(--color-warning-ink)]"
                : "mt-2 text-base text-[var(--color-text-muted)]"
            }
          >
            {intro}
          </p>
        </div>

        <ChangePasswordForm hasPassword={hasPassword} required={required} />

        {/* No way back while the temporary password is still active: every
            other page would answer password_change_required anyway. */}
        {!required && (
          <p className="text-center">
            <Link
              href={`/${locale}/settings`}
              className="text-base font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
            >
              {t("back")}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
