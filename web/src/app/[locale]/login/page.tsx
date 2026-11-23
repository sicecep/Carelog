import { getTranslations } from "next-intl/server";
import { isLoginRole } from "@/lib/login-role";
import { LoginRoleChoice } from "./login-role-choice";

interface LoginPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ role?: string | string[] }>;
}

export default async function LoginPage({ params, searchParams }: LoginPageProps) {
  const { locale } = await params;
  // ?role=caregiver|owner opens that form directly (links from the invite
  // and pending pages, E2E). Anything else shows the role choice.
  const { role } = await searchParams;
  const initialRole = isLoginRole(role) ? role : undefined;
  const t = await getTranslations({ locale, namespace: "auth" });
  const common = await getTranslations({ locale, namespace: "common" });
  // The platform owner's WhatsApp for "Lupa kata sandi?" (login revamp D5).
  // Read on the server and passed down, so it needs no NEXT_PUBLIC_ variable.
  // Digits only, as wa.me expects; anything else hides the link.
  const supportWhatsApp = process.env.SUPPORT_WHATSAPP?.replace(/\D/g, "") || undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-hover)] px-4 py-8">
      <div className="w-full max-w-md space-y-8 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-sm sm:p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[var(--color-text)]">{common("appName")}</h1>
          <p className="mt-2 text-lg text-[var(--color-text-muted)]">{t("login")}</p>
        </div>

        {/* The "Buat akun" link lives in the owner form now: only family
            sign up; caregivers join through an invite. */}
        <LoginRoleChoice supportWhatsApp={supportWhatsApp} initialRole={initialRole} />
      </div>
    </div>
  );
}
