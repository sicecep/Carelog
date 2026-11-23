import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SupportWhatsAppLink } from "@/components/ui/SupportWhatsAppLink";
import { AuthShell, authViewport } from "@/components/ui/AuthShell";

export const viewport = authViewport;

interface PendingPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}

// Landing page for accounts blocked by the signup approval gate.
//
// Deliberately requires NO authentication: sign-up and sign-in send users
// here precisely because they were refused a session. Anything gated behind
// auth would be unreachable for the exact audience this page exists for.
//
// Nothing is verified at sign-up and no email or SMS is sent on approval
// (login revamp §4.1), so the page says how to find out instead: try signing
// in later, or message the CareLog admin (SUPPORT_WHATSAPP).
export default async function PendingPage({ params, searchParams }: PendingPageProps) {
  const { locale } = await params;
  const { status } = await searchParams;
  const t = await getTranslations({ locale, namespace: "pending" });
  const common = await getTranslations({ locale, namespace: "common" });

  const rejected = status === "rejected";
  // Digits only, as wa.me expects; anything else hides the button.
  const supportWhatsApp = process.env.SUPPORT_WHATSAPP?.replace(/\D/g, "") || undefined;

  return (
    <AuthShell appName={common("appName")}>
      <div className="flex flex-1 flex-col text-center">
        <div>
          <h1 className="mb-3 text-2xl font-medium text-[var(--color-text)]">
            {rejected ? t("titleRejected") : t("titlePending")}
          </h1>

          <p className="mb-4 text-base leading-relaxed text-[var(--color-text-muted)]">
            {rejected ? t("bodyRejected") : t("bodyPending")}
          </p>

          <p className="mb-6 text-base text-[var(--color-text-muted)]">
            {supportWhatsApp
              ? rejected
                ? t("nextRejected")
                : t("nextPending")
              : t("nextNoContact")}
          </p>

          {supportWhatsApp && (
            <div className="mb-4">
              <SupportWhatsAppLink
                phone={supportWhatsApp}
                message={rejected ? t("whatsAppMessageRejected") : t("whatsAppMessagePending")}
                label={t("whatsAppButton")}
              />
            </div>
          )}

        </div>

        <Link
          href={`/${locale}/login?role=owner`}
          className="btn-base btn-secondary touch-target mt-auto inline-flex w-full items-center justify-center"
        >
          {t("backToLogin")}
        </Link>
      </div>
    </AuthShell>
  );
}
