import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  recipientApi,
  workspaceApi,
  type MeResponse,
  type Recipient,
} from "@/lib/api-client";
import { PLAN_LIMITS, type Plan } from "@/lib/constants.generated";
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
  let plan: Plan = "free";
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
      const [activeRes, archivedRes, wsRes] = await Promise.all([
        recipientApi.list(workspace.id, forwarded),
        recipientApi.listArchived(workspace.id, forwarded),
        // Plan drives the quota notice. Non-fatal: allSettled would be
        // overkill here since the other two already throw on auth failure,
        // but a plan lookup failure must not blank the page — fall back to
        // the free tier, which only ever UNDER-promises capacity.
        workspaceApi.get(workspace.id, forwarded).catch(() => null),
      ]);
      // Same dedupe as the dashboard: two independent queries can overlap if a
      // row flips is_active between the round-trips. Active wins.
      const byId = new Map<string, Recipient>();
      for (const r of archivedRes.data ?? []) byId.set(r.id, r);
      for (const r of activeRes.data ?? []) byId.set(r.id, r);
      recipients = [...byId.values()];

      const p = wsRes?.data?.plan;
      if (p && p in PLAN_LIMITS) plan = p as Plan;
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

  // Plan quota. The enforce_profile_limit trigger counts ACTIVE recipients
  // only, so archived profiles must not count here either — otherwise the UI
  // would block an add the API would happily accept.
  const maxRecipients = PLAN_LIMITS[plan].maxRecipients;
  const activeCount = recipients.filter((r) => r.is_active).length;
  const atLimit = maxRecipients !== null && activeCount >= maxRecipients;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-medium text-[var(--color-text)]">
            {t("listTitle")}
          </h1>
          {canAdd && !atLimit && (
            <Link
              href={`/${locale}/onboarding?new=1`}
              // Visible label is just "Tambah"/"Add" — the full phrase
              // overflowed on Indonesian at phone widths, and the adjacent
              // page heading already supplies the object. aria-label keeps
              // the full description for screen readers, since the "+" is
              // aria-hidden and would otherwise leave a bare verb.
              aria-label={t("addRecipientAria")}
              className="btn-base btn-primary touch-target flex items-center gap-2 px-4 text-sm"
            >
              {/* Text "+" rather than a phosphor icon: this is a server
                  component, and phosphor icons read IconContext (client-only). */}
              <span aria-hidden="true" className="text-base leading-none">+</span>
              <span>{dashboard("addRecipient")}</span>
            </Link>
          )}
          {canAdd && atLimit && (
            // Rendered as a disabled button rather than hidden: the control
            // vanishing would read as a bug, and the adjacent notice explains
            // why it is unavailable.
            <button
              type="button"
              disabled
              aria-label={t("planLimitAria")}
              className="btn-base btn-secondary touch-target flex items-center gap-2 px-4 text-sm"
            >
              <span aria-hidden="true" className="text-base leading-none">+</span>
              <span>{dashboard("addRecipient")}</span>
            </button>
          )}
        </div>

        {canAdd && atLimit && (
          <section
            aria-labelledby="plan-limit-heading"
            className="card mb-6 border-2 border-[var(--color-border-strong)]"
          >
            <h2
              id="plan-limit-heading"
              className="text-base font-semibold text-[var(--color-text)]"
            >
              {t("planLimitTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t("planLimitBody", { plan, max: maxRecipients ?? 0 })}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t("planCountLabel", { used: activeCount, max: maxRecipients ?? 0 })}
            </p>
            <Link
              href={`/${locale}/settings`}
              className="btn-base btn-primary touch-target mt-3 inline-flex px-4 text-sm"
            >
              {t("planLimitCta")}
            </Link>
          </section>
        )}

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
