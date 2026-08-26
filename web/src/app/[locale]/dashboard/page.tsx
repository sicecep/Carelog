import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  recipientApi,
  type MeResponse,
  type Recipient,
} from "@/lib/api-client";
import { LogoutButton } from "./logout-button";
import { RecipientsSection } from "./recipients-section";

interface DashboardPageProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const common = await getTranslations({ locale, namespace: "common" });

  // Fetched server-side rather than in a client effect. `credentials: "include"`
  // is a browser-only concept — a server fetch has no cookie jar — so the
  // incoming Cookie header is forwarded to the Go API explicitly. This works
  // because cookies are not scoped by port: cl_access, set by the API on
  // localhost:8080, is also sent to the Next server on localhost:3000.
  const forwarded = { Cookie: (await cookies()).toString() };

  let me: MeResponse | null = null;
  let recipients: Recipient[] = [];
  let redirectToLogin = false;
  let loadFailed = false;

  try {
    const res = await authApi.me(undefined, forwarded);
    me = res.data;
    if (!me) loadFailed = true;
  } catch (err) {
    // proxy.ts only checks that a cookie exists; the API is authoritative on
    // whether it is still valid.
    if (err instanceof APIError && err.status === 401) {
      redirectToLogin = true;
    } else {
      console.error("dashboard: /auth/me failed", err);
      loadFailed = true;
    }
  }

  // A user always has at least one workspace once onboarding has run; `active`
  // marks the one to scope this session to.
  const workspace = me?.workspaces.find((w) => w.active) ?? me?.workspaces[0] ?? null;

  if (workspace) {
    try {
      const res = await recipientApi.list(workspace.id, forwarded);
      recipients = res.data ?? [];
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        redirectToLogin = true;
      } else {
        console.error("dashboard: /recipients failed", err);
        loadFailed = true;
      }
    }
  }

  // redirect() works by throwing NEXT_REDIRECT, so it has to run outside the
  // try/catch blocks above or they would swallow it.
  if (redirectToLogin) redirect(`/${locale}/login`);

  const displayName = me?.user.full_name?.trim() || me?.user.email.split("@")[0] || "";

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <span className="text-lg font-semibold text-[var(--color-text)]">
            {common("appName")}
          </span>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {me ? (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-medium text-[var(--color-text)]">
                {t("welcome", { name: displayName })}
              </h1>
              {workspace && (
                <p className="mt-2">
                  <span className="sr-only">{t("workspaceLabel")}: </span>
                  <span className="inline-block rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm text-[var(--color-accent-ink)]">
                    {workspace.name}
                  </span>
                </p>
              )}
            </div>

            <section aria-labelledby="recipients-heading">
              <h2
                id="recipients-heading"
                className="mb-4 text-xl font-medium text-[var(--color-text)]"
              >
                {t("recipientsHeading")}
              </h2>

              {loadFailed ? (
                <p role="alert" className="card text-base text-[var(--color-error-ink)]">
                  {t("loadError")}
                </p>
              ) : (
                <RecipientsSection recipients={recipients} />
              )}
            </section>
          </>
        ) : (
          <p role="alert" className="card text-base text-[var(--color-error-ink)]">
            {t("loadError")}
          </p>
        )}
      </main>
    </div>
  );
}
