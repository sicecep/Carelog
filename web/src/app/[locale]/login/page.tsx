import { getTranslations } from "next-intl/server";
import { isLoginRole } from "@/lib/login-role";
import { LoginRoleChoice } from "./login-role-choice";
import { AuthShell, authViewport } from "@/components/ui/AuthShell";

export const viewport = authViewport;

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
  const landing = await getTranslations({ locale, namespace: "landing" });
  // The platform owner's WhatsApp for "Lupa kata sandi?" (login revamp D5).
  // Read on the server and passed down, so it needs no NEXT_PUBLIC_ variable.
  // Digits only, as wa.me expects; anything else hides the link.
  const supportWhatsApp = process.env.SUPPORT_WHATSAPP?.replace(/\D/g, "") || undefined;

  return (
    <AuthShell appName={common("appName")} tagline={landing("tagline")}>
      <h1 className="sr-only">{t("login")}</h1>
      <LoginRoleChoice supportWhatsApp={supportWhatsApp} initialRole={initialRole} />
    </AuthShell>
  );
}
