import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  invitationApi,
  memberApi,
  pinResetApi,
  workspaceApi,
  type Invitation,
  type Member,
  type MeResponse,
  type PendingPINReset,
} from "@/lib/api-client";
import { DEFAULT_TIMEZONE } from "@/lib/format-time";
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

  // The roster and (owners) the open invitations, fetched here so the page
  // shows them straight away instead of behind "Kelola …" buttons. Each is
  // non-fatal: an empty list still renders with its empty state.
  let members: Member[] = [];
  let invites: Invitation[] = [];
  let timezone = DEFAULT_TIMEZONE;
  if (workspace) {
    const [membersRes, invitesRes, wsRes] = await Promise.all([
      memberApi.list(workspace.id, forwarded).catch(() => null),
      role === "owner"
        ? invitationApi.list(workspace.id, forwarded).catch(() => null)
        : Promise.resolve(null),
      workspaceApi.get(workspace.id, forwarded).catch(() => null),
    ]);
    members = membersRes?.data ?? [];
    invites = invitesRes?.data ?? [];
    timezone = wsRes?.data?.timezone ?? DEFAULT_TIMEZONE;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            {t("title")}
          </h1>
          {/* Invite is owner-only: the API rejects non-owners (403), so the
              entry point is hidden for caregivers/viewers, not disabled. */}
          {workspace && role === "owner" && (
            <InviteCaregiver workspaceId={workspace.id} />
          )}
        </div>

        {workspace ? (
          <div className="space-y-10">
            {/* AUTH-005: caregivers who forget their PIN need an owner to
                approve a reset. First on the page because it is the one
                thing here that someone is waiting on; shown only when there
                is a request (or the list failed to load). */}
            {role === "owner" && (pendingResets.length > 0 || pendingResetsFailed) && (
              <section aria-labelledby="pin-resets-heading">
                <h2
                  id="pin-resets-heading"
                  className="mb-4 text-xl font-semibold text-[var(--color-text)]"
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

            <section aria-labelledby="members-heading">
              <h2 id="members-heading" className="mb-4 text-xl font-semibold text-[var(--color-text)]">
                {t("membersHeading", { count: members.length })}
              </h2>
              <CareTeamList
                workspaceId={workspace.id}
                currentUserId={me!.user.id}
                canManage={role === "owner"}
                initialMembers={members}
                timezone={timezone}
              />
            </section>

            {role === "owner" && (
              <section aria-labelledby="invitations-heading">
                <h2
                  id="invitations-heading"
                  className="mb-4 text-xl font-semibold text-[var(--color-text)]"
                >
                  {dashboard("invitationsHeading")}
                </h2>
                <InvitationList workspaceId={workspace.id} initialInvites={invites} timezone={timezone} />
              </section>
            )}
          </div>
        ) : (
          <p role="alert" className="card text-base text-[var(--color-error-ink)]">
            {dashboard("loadError")}
          </p>
        )}
      </main>
    </div>
  );
}
