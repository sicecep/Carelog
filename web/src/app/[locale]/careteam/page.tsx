import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  pinResetApi,
  type MeResponse,
  type PendingPINReset,
} from "@/lib/api-client";
import { AppHeader } from "@/components/ui/AppHeader";
import { InviteCaregiver } from "@/components/ui/InviteCaregiver";
import { PinResetApprovals } from "@/components/ui/PinResetApprovals";
import { InvitationList } from "@/components/ui/InvitationList";
import { CareTeamList } from "@/components/ui/CareTeamList";

interface CareTeamPageProps {
  params: Promise<{ locale: string }>;
}

export default async function CareTeamPage({ params }: CareTeamPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "careteam" });
  const dashboard = await getTranslations({ locale, namespace: "dashboard" });
  const pinResets = await getTranslations({ locale, namespace: "pinResets" });

  const forwarded = { Cookie: (await cookies()).toString() };

  let me: MeResponse | null = null;
  let redirectToLogin = false;

  try {
    const res = await authApi.me(undefined, forwarded);
    me = res.data;
    if (!me) redirect(`/${locale}/login`);
  } catch (err) {
    if (err instanceof APIError && err.status === 401) {
      redirectToLogin = true;
    } else {
      console.error("careteam page: /auth/me failed", err);
      redirectToLogin = true;
    }
  }

  if (redirectToLogin) redirect(`/${locale}/login`);

  const workspace = me?.workspaces.find((w) => w.active) ?? me?.workspaces[0] ?? null;
  const role = (workspace?.role ?? "viewer") as "owner" | "caregiver" | "viewer";

  // AUTH-005: pending PIN resets, fetched server-side. Only owners can read
  // this endpoint (403 otherwise), so don't even ask for other roles.
  // A failure here must not blank the whole care-team page — the list
  // degrades to an inline error while members and invitations still render.
  let pendingResets: PendingPINReset[] = [];
  let pendingResetsFailed = false;
  if (workspace && role === "owner") {
    try {
      const res = await pinResetApi.list(workspace.id, forwarded);
      pendingResets = res.data ?? [];
    } catch (err) {
      console.error("careteam page: pin-resets failed", err);
      pendingResetsFailed = true;
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-medium text-[var(--color-text)]">
            {t("title")}
          </h1>
          {/* Invite is owner-only: the API rejects non-owners (403), so the
              entry point is hidden for caregivers/viewers, not disabled. */}
          {workspace && role === "owner" && (
            <InviteCaregiver workspaceId={workspace.id} />
          )}
        </div>

        {workspace ? (
          <>
            <CareTeamList
              workspaceId={workspace.id}
              currentUserId={me!.user.id}
              canManage={role === "owner"}
            />

            {/* AUTH-005: caregivers who forget their PIN need an owner to
                approve a reset. Owner-only, hidden (not disabled) for other
                roles — the API 403s them anyway. */}
            {role === "owner" && (
              <section aria-labelledby="pin-resets-heading" className="mt-8">
                <h2
                  id="pin-resets-heading"
                  className="mb-4 text-xl font-medium text-[var(--color-text)]"
                >
                  {pinResets("heading")}
                </h2>
                <PinResetApprovals
                  workspaceId={workspace.id}
                  initialItems={pendingResets}
                  initialError={pendingResetsFailed}
                />
              </section>
            )}

            {role === "owner" && (
              <section aria-labelledby="invitations-heading" className="mt-8">
                <h2
                  id="invitations-heading"
                  className="mb-4 text-xl font-medium text-[var(--color-text)]"
                >
                  {dashboard("invitationsHeading")}
                </h2>
                <InvitationList workspaceId={workspace.id} />
              </section>
            )}
          </>
        ) : (
          <p role="alert" className="card text-base text-[var(--color-error-ink)]">
            {dashboard("loadError")}
          </p>
        )}
      </main>
    </div>
  );
}
