import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LoginMethodTabs } from "./login-method-tabs";

interface LoginPageProps {
  params: Promise<{ locale: string }>;
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  const common = await getTranslations({ locale, namespace: "common" });
  // The platform owner's WhatsApp for "Lupa kata sandi?" (login revamp D5).
  // Read on the server and passed down, so it needs no NEXT_PUBLIC_ variable.
  // Digits only, as wa.me expects; anything else hides the link.
  const supportWhatsApp = process.env.SUPPORT_WHATSAPP?.replace(/\D/g, "") || undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-hover)] px-4 py-8">
      <div className="w-full max-w-md space-y-8 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[var(--color-text)]">{common("appName")}</h1>
          <h2 className="mt-6 text-2xl font-semibold text-[var(--color-text)]">{t("login")}</h2>
          <p className="mt-2 text-base text-[var(--color-text-muted)]">{t("loginIntro")}</p>
        </div>

        <LoginMethodTabs supportWhatsApp={supportWhatsApp} />

        {/* Mirror of the register page's "already have an account?" link:
            someone arriving straight at /login (bookmark, old link, the
            pending page's back-link) must still be able to reach /register
            without knowing the URL. */}
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          {t("noAccount")}{" "}
          <Link
            href={`/${locale}/register`}
            className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            {t("createAccount")}
          </Link>
        </p>
      </div>
    </div>
  );
}
