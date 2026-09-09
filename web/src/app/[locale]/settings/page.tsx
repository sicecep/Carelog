import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  workspaceApi,
  type MeResponse,
  type Workspace,
} from "@/lib/api-client";
import { WorkspaceSettingsForm } from "@/components/ui/WorkspaceSettingsForm";

interface SettingsPageProps {
  params: Promise<{ locale: string }>;
}

// Workspace settings. Readable by any member; the form renders read-only for
// non-owners, mirroring the API's owner-only guard on PATCH and DELETE.
export default async function SettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "workspaceSettings" });
  const common = await getTranslations({ locale, namespace: "common" });

  // A server fetch has no cookie jar, so the incoming Cookie header is
  // forwarded explicitly. See authApi.me for the full reasoning.
  const forwarded = { Cookie: (await cookies()).toString() };

  let me: MeResponse | null = null;
  let workspace: Workspace | null = null;
  let redirectToLogin = false;
  let loadFailed = false;

  try {
    const res = await authApi.me(undefined, forwarded);
    me = res.data;
    if (!me) loadFailed = true;
  } catch (err) {
    if (err instanceof APIError && err.status === 401) {
      redirectToLogin = true;
    } else {
      console.error("settings: /auth/me failed", err);
      loadFailed = true;
    }
  }

  const active = me?.workspaces.find((w) => w.active) ?? me?.workspaces[0] ?? null;

  if (active) {
    try {
      const res = await workspaceApi.get(active.id, forwarded);
      workspace = res.data;
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        redirectToLogin = true;
      } else {
        console.error("settings: /workspace failed", err);
        loadFailed = true;
      }
    }
  }

  // redirect() throws NEXT_REDIRECT, so it must run outside the try/catch that
  // would otherwise swallow it.
  if (redirectToLogin) redirect(`/${locale}/login`);

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="text-lg font-semibold text-[var(--color-text)]">
            {common("appName")}
          </span>
          <Link
            href={`/${locale}/dashboard`}
            className="btn-base btn-ghost touch-target px-3 text-sm"
          >
            ← {common("appName")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="mb-6 text-2xl font-medium text-[var(--color-text)]">{t("title")}</h1>

        {loadFailed || !workspace ? (
          <p role="alert" className="card p-6 text-base text-[var(--color-error-ink)]">
            {t("errorGeneric")}
          </p>
        ) : (
          <WorkspaceSettingsForm workspace={workspace} locale={locale} />
        )}
      </main>
    </div>
  );
}
