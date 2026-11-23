import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authApi, APIError } from "@/lib/api-client";
import { RegisterForm } from "./register-form";
import { AuthCompact, AuthShell, authViewport } from "@/components/ui/AuthShell";

export const viewport = authViewport;

interface RegisterPageProps {
  params: Promise<{ locale: string }>;
}

// Owner self-registration with email and/or phone + password (login revamp
// D1). The account waits for super-admin approval before it can sign in.
export default async function RegisterPage({ params }: RegisterPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "register" });

  // Already signed in? You don't need to register.
  // NOTE: redirect() throws NEXT_REDIRECT, so it must run OUTSIDE this
  // try/catch or the catch swallows it and the member sees the register
  // page anyway.
  const forwarded = { Cookie: (await cookies()).toString() };
  let signedIn = false;
  try {
    const res = await authApi.me(undefined, forwarded);
    signedIn = Boolean(res.data);
  } catch (err) {
    if (!(err instanceof APIError && err.status === 401)) {
      console.error("register: /auth/me failed", err);
    }
  }
  if (signedIn) redirect(`/${locale}/dashboard`);

  return (
    <AuthShell appName="CareLog">
      <AuthCompact />
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t("title")}</h1>
          <p className="mt-2 text-base text-[var(--color-text-muted)]">{t("intro")}</p>
        </div>

        <RegisterForm />

        <p className="text-center text-base text-[var(--color-text-muted)]">
          {t("haveAccount")}{" "}
          <Link
            href={`/${locale}/login?role=owner`}
            className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            {t("signIn")}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
