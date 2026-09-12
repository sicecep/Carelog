import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authApi, APIError } from "@/lib/api-client";
import { LoginForm } from "../login/login-form";

interface RegisterPageProps {
  params: Promise<{ locale: string }>;
}

// Register-framed entry to the magic-link flow. Same endpoint as /login —
// the API deliberately doesn't distinguish sign-up from sign-in (email
// enumeration protection) — so this page differs only in copy and, on
// success, tells an existing account holder that the link signs them in.
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">CareLog</h1>
          <h2 className="mt-6 text-2xl font-semibold text-gray-700">{t("title")}</h2>
          <p className="mt-2 text-base text-gray-600">{t("intro")}</p>
        </div>

        <LoginForm variant="register" />

        <p className="text-center text-sm text-gray-600">
          {t("haveAccount")}{" "}
          <Link
            href={`/${locale}/login`}
            className="font-medium text-blue-600 hover:text-blue-700"
          >
            {t("signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
