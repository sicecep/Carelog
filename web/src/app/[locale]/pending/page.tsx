import Link from "next/link";
import { getTranslations } from "next-intl/server";

interface PendingPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}

// Landing page for accounts blocked by the signup approval gate.
//
// Deliberately requires NO authentication: the verify handler sends users here
// precisely because it refused to issue them a session. Anything gated behind
// auth would be unreachable for the exact audience this page exists for.
export default async function PendingPage({ params, searchParams }: PendingPageProps) {
  const { locale } = await params;
  const { status } = await searchParams;
  const t = await getTranslations({ locale, namespace: "pending" });
  const common = await getTranslations({ locale, namespace: "common" });

  const rejected = status === "rejected";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4 py-12">
      <main className="w-full max-w-md">
        <div className="card p-6 text-center">
          <h1 className="mb-3 text-2xl font-medium text-[var(--color-text)]">
            {rejected ? t("titleRejected") : t("titlePending")}
          </h1>

          <p className="mb-4 text-base leading-relaxed text-[var(--color-text-muted)]">
            {rejected ? t("bodyRejected") : t("bodyPending")}
          </p>

          {!rejected && (
            <p className="mb-6 text-sm text-[var(--color-text-muted)]">{t("emailVerified")}</p>
          )}

          <Link
            href={`/${locale}/login`}
            className="btn-base btn-secondary touch-target inline-flex items-center justify-center"
          >
            {t("backToLogin")}
          </Link>
        </div>

        <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
          {common("appName")}
        </p>
      </main>
    </div>
  );
}
