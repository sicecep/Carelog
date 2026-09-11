import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  recipientApi,
  type MeResponse,
  type Recipient,
} from "@/lib/api-client";
import { AppHeader } from "@/components/ui/AppHeader";
import { RecipientsSection } from "../dashboard/recipients-section";

interface RecipientsPageProps {
  params: Promise<{ locale: string }>;
}

export default async function RecipientsPage({ params }: RecipientsPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "recipients" });
  const dashboard = await getTranslations({ locale, namespace: "dashboard" });

  // Server-side fetch with the Cookie header forwarded, same as the dashboard.
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
    if (err instanceof APIError && err.status === 401) {
      redirectToLogin = true;
    } else {
      console.error("recipients page: /auth/me failed", err);
      loadFailed = true;
    }
  }

  const workspace = me?.workspaces.find((w) => w.active) ?? me?.workspaces[0] ?? null;

  if (workspace) {
    try {
      const [activeRes, archivedRes] = await Promise.all([
        recipientApi.list(workspace.id, forwarded),
        recipientApi.listArchived(workspace.id, forwarded),
      ]);
      // Same dedupe as the dashboard: two independent queries can overlap if a
      // row flips is_active between the round-trips. Active wins.
      const byId = new Map<string, Recipient>();
      for (const r of archivedRes.data ?? []) byId.set(r.id, r);
      for (const r of activeRes.data ?? []) byId.set(r.id, r);
      recipients = [...byId.values()];
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        redirectToLogin = true;
      } else {
        console.error("recipients page: /recipients failed", err);
        loadFailed = true;
      }
    }
  }

  if (redirectToLogin) redirect(`/${locale}/login`);

  const role = (workspace?.role ?? "viewer") as "owner" | "caregiver" | "viewer";
  // Adding a recipient is a write: owners and caregivers may, viewers are
  // read-only by design (the API's RequireWriter would 403 them anyway, so
  // the button is hidden rather than shown dead).
  const canAdd = role === "owner" || role === "caregiver";

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-medium text-[var(--color-text)]">
            {t("listTitle")}
          </h1>
          {canAdd && (
            <Link
              href={`/${locale}/onboarding?new=1`}
              className="btn-base btn-primary touch-target flex items-center gap-2 px-4 text-sm"
            >
              {/* Text "+" rather than a phosphor icon: this is a server
                  component, and phosphor icons read IconContext (client-only). */}
              <span aria-hidden="true" className="text-base leading-none">+</span>
              <span>{dashboard("addRecipient")}</span>
            </Link>
          )}
        </div>

        {loadFailed ? (
          <p role="alert" className="card text-base text-[var(--color-error-ink)]">
            {dashboard("loadError")}
          </p>
        ) : (
          <RecipientsSection recipients={recipients} />
        )}
      </main>
    </div>
  );
}
