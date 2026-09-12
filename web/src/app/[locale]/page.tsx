import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { APIError, authApi } from "@/lib/api-client";

interface LandingPageProps {
  params: Promise<{ locale: string }>;
}

// Locale landing: the app's front door. `/` is redirected here by the
// next-intl middleware (localePrefix "always"), so this is the first thing
// an unauthenticated visitor sees: choose login or register.
export default async function LandingPage({ params }: LandingPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  const common = await getTranslations({ locale, namespace: "common" });

  // A signed-in member opening the app root expects their dashboard, not a
  // login/register choice. Server fetch with the Cookie header forwarded
  // (same pattern as the other authed pages).
  // NOTE: redirect() throws NEXT_REDIRECT, so it must run OUTSIDE this
  // try/catch or the catch swallows it (the dashboard documents the same
  // pitfall) and the member sees the landing anyway.
  const forwarded = { Cookie: (await cookies()).toString() };
  let signedIn = false;
  try {
    const res = await authApi.me(undefined, forwarded);
    signedIn = Boolean(res.data);
  } catch (err) {
    if (!(err instanceof APIError && err.status === 401)) {
      console.error("landing: /auth/me failed", err);
    }
  }
  if (signedIn) redirect(`/${locale}/dashboard`);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 text-center shadow-sm">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">{common("appName")}</h1>
          <p className="mt-3 text-base text-gray-600">{t("tagline")}</p>
        </div>

        <div className="space-y-3">
          {/* Register is the primary action (growth); login the familiar one.
              Both 56px targets — this page is the mobile front door. */}
          <Link
            href={`/${locale}/register`}
            className="flex h-14 w-full items-center justify-center rounded-md bg-blue-600 px-4 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {t("registerButton")}
          </Link>
          <Link
            href={`/${locale}/login`}
            className="flex h-14 w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {t("loginButton")}
          </Link>
        </div>
      </div>
    </div>
  );
}
