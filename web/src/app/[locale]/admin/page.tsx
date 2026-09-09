import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { APIError, adminApi, type AdminUser } from "@/lib/api-client";
import { AdminUserList } from "@/components/ui/AdminUserList";

interface AdminPageProps {
  params: Promise<{ locale: string }>;
}

// Super-admin dashboard for approving or rejecting owner signups.
//
// Authorization is enforced server-side by the API (RequireSuperAdmin), which
// answers 404 for non-admins so the route's existence isn't disclosed. This
// page mirrors that: a non-admin sees the same not-found treatment rather than
// a "you lack permission" hint.
export default async function AdminPage({ params }: AdminPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  const common = await getTranslations({ locale, namespace: "common" });

  // Server-side fetch has no cookie jar, so the incoming Cookie header is
  // forwarded to the Go API explicitly. See authApi.me for the full reasoning.
  const forwarded = { Cookie: (await cookies()).toString() };

  let users: AdminUser[] = [];
  let denied = false;
  let loadFailed = false;
  let redirectToLogin = false;

  try {
    const res = await adminApi.listUsers("pending", forwarded);
    users = res.data ?? [];
  } catch (err) {
    if (err instanceof APIError && err.status === 401) {
      redirectToLogin = true;
    } else if (err instanceof APIError && (err.status === 404 || err.status === 403)) {
      denied = true;
    } else {
      console.error("admin: list pending users failed", err);
      loadFailed = true;
    }
  }

  // redirect() throws NEXT_REDIRECT, so it must run outside the try/catch that
  // would otherwise swallow it.
  if (redirectToLogin) redirect(`/${locale}/login`);

  if (denied) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
        <p role="alert" className="card p-6 text-center text-[var(--color-text-muted)]">
          {t("accessDenied")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="text-lg font-semibold text-[var(--color-text)]">
            {common("appName")} · {t("title")}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="mb-6 text-2xl font-medium text-[var(--color-text)]">
          {t("pendingHeading")}
        </h1>

        {loadFailed ? (
          <p role="alert" className="card p-6 text-base text-[var(--color-error-ink)]">
            {t("errorGeneric")}
          </p>
        ) : (
          <AdminUserList initialUsers={users} />
        )}
      </main>
    </div>
  );
}
