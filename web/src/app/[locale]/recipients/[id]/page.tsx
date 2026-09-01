import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  incidentApi,
  recipientApi,
  type Incident,
  type Recipient,
  type ReportEntry,
} from "@/lib/api-client";
import { DetailActions } from "./detail-actions";
import { DetailHeader, TimelineList } from "./detail-sections";

interface RecipientPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function RecipientDetailPage({ params }: RecipientPageProps) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "recipients" });
  const common = await getTranslations({ locale, namespace: "common" });

  // Server Component fetch: forward the incoming Cookie header explicitly —
  // a server-side fetch has no cookie jar (same pattern as the dashboard).
  const forwarded = { Cookie: (await cookies()).toString() };

  let recipient: Recipient | null = null;
  let entries: ReportEntry[] = [];
  let incidents: Incident[] = [];
  let workspaceId: string | null = null;
  let isOwner = false;
  let redirectToLogin = false;
  let notFound = false;
  let loadFailed = false;

  try {
    const me = await authApi.me(undefined, forwarded);
    const workspace =
      me.data?.workspaces.find((w) => w.active) ?? me.data?.workspaces[0] ?? null;
    if (!workspace) redirect(`/${locale}/dashboard`);
    workspaceId = workspace.id;
    isOwner = workspace.role === "owner";

    const res = await recipientApi.get(workspace.id, id, forwarded);
    recipient = res.data;

    if (recipient) {
      // Timeline and incidents are non-fatal: the profile still renders if
      // either of these fails.
      const [entriesRes, incidentsRes] = await Promise.allSettled([
        recipientApi.getTimeline(workspace.id, id, undefined, forwarded),
        incidentApi.listForRecipient(workspace.id, id, undefined, forwarded),
      ]);
      if (entriesRes.status === "fulfilled") entries = entriesRes.value.data ?? [];
      if (incidentsRes.status === "fulfilled") incidents = incidentsRes.value.data ?? [];
    }
  } catch (err) {
    if (err instanceof APIError && err.status === 401) {
      redirectToLogin = true;
    } else if (err instanceof APIError && err.status === 404) {
      notFound = true;
    } else {
      console.error("recipient detail: load failed", err);
      loadFailed = true;
    }
  }

  // redirect() throws NEXT_REDIRECT — must run outside try/catch.
  if (redirectToLogin) redirect(`/${locale}/login`);

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2 sm:px-6">
          <Link
            href={`/${locale}/dashboard`}
            className="touch-target flex items-center gap-2 text-base text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <span aria-hidden="true">&larr;</span>
            <span>{t("detailBack")}</span>
          </Link>
          <span className="ml-auto text-lg font-semibold text-[var(--color-text)]">
            {common("appName")}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 pb-28 sm:px-6">
        {notFound || (!recipient && !loadFailed) ? (
          <div className="card px-6 py-12 text-center">
            <h1 className="text-xl font-medium text-[var(--color-text)]">
              {t("detailNotFoundTitle")}
            </h1>
            <p className="mt-2 text-base text-[var(--color-text-muted)]">
              {t("detailNotFoundBody")}
            </p>
          </div>
        ) : loadFailed ? (
          <p role="alert" className="card text-base text-[var(--color-error-ink)]">
            {t("detailLoadError")}
          </p>
        ) : recipient ? (
          <>
            <DetailHeader recipient={recipient} />

            <section aria-labelledby="timeline-heading" className="mt-8">
              <h2
                id="timeline-heading"
                className="mb-4 text-xl font-medium text-[var(--color-text)]"
              >
                {t("detailTimelineHeading")}
              </h2>
              <TimelineList entries={entries} incidents={incidents} isOwner={isOwner} workspaceId={workspaceId!} />
            </section>

            {workspaceId && (
              <DetailActions recipientId={recipient.id} workspaceId={workspaceId} />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
