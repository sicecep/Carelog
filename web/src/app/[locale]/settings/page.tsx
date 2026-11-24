import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  reminderApi,
  workspaceApi,
  type MeResponse,
  type ReminderPrefs,
  type Workspace,
} from "@/lib/api-client";
import { WorkspaceSettingsForm } from "@/components/ui/WorkspaceSettingsForm";
import { ReminderSettings } from "@/components/ui/ReminderSettings";
import { AppHeader } from "@/components/ui/AppHeader";
import { LogoutButton } from "@/components/ui/LogoutButton";
import { AppearanceSetting } from "@/components/ui/AppearanceSetting";
import { APPEARANCE_COOKIE, parseAppearance } from "@/lib/appearance";

interface SettingsPageProps {
  params: Promise<{ locale: string }>;
}

// The "Akun" tab: the signed-in person's own account (who they are, password,
// sign out, caregiver reminders), then workspace settings for owners only —
// the API guards PATCH and DELETE on the workspace to owners.
export default async function SettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "workspaceSettings" });
  const tAccount = await getTranslations({ locale, namespace: "settings" });
  const tMe = await getTranslations({ locale, namespace: "account" });

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
  let reminderPrefs: ReminderPrefs | null = null;
  // Workspace endpoints answer password_change_required until an admin-issued
  // temporary password is replaced; go straight to the change screen.
  const mustChangePassword = me?.auth?.password_change_required ?? false;
  // Owners sign in with a password (or should set one); caregivers use a
  // PIN, so the section only shows when it applies.
  const showPassword = Boolean(me?.auth?.has_password || active?.role === "owner");
  const isOwner = active?.role === "owner";

  if (active && !mustChangePassword) {
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

    // NOT-001 (6): reminder prefs are meaningful only for caregivers —
    // owners receive the digest, never the reminder. Skip the fetch for
    // owners so the API is not asked for a value the UI will never render.
    if (active.role === "caregiver") {
      try {
        const res = await reminderApi.get(active.id, forwarded);
        reminderPrefs = res.data;
      } catch (err) {
        // Non-fatal: absent prefs = defaults (enabled, no snooze). The
        // API returns the same, so a fetch failure here just means the
        // caregiver sees the default state until the next reload.
        console.error("settings: /me/reminder-prefs failed", err);
        reminderPrefs = { disabled: false, snoozed_until: null };
      }
    }
  }

  // redirect() throws NEXT_REDIRECT, so it must run outside the try/catch that
  // would otherwise swallow it.
  if (redirectToLogin) redirect(`/${locale}/login`);
  if (mustChangePassword) redirect(`/${locale}/change-password`);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="mb-6 text-2xl font-semibold text-[var(--color-text)]">{tMe("title")}</h1>

        {/* Outside the load-failed branch: signing out must work even when
            the workspace can't be loaded. */}
        <section className="card" aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-lg font-semibold text-[var(--color-text)]">
            {tMe("profileHeading")}
          </h2>
          {me?.user.full_name?.trim() && (
            <p className="mt-3 text-lg font-medium wrap-anywhere text-[var(--color-text)]">
              {me.user.full_name.trim()}
            </p>
          )}
          {me?.user.email && (
            <p className="mt-1 text-base wrap-anywhere text-[var(--color-text-muted)]">
              {tMe("signedInAs", { identity: me.user.email })}
            </p>
          )}
          {showPassword && (
            <div className="mt-6 border-t border-[var(--color-border)] pt-5">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {tAccount("passwordSection")}
              </h3>
              <Link
                href={`/${locale}/change-password`}
                className="btn-base btn-secondary touch-target mt-3 w-full sm:w-auto"
              >
                {me?.auth?.has_password ? tAccount("passwordChange") : tAccount("passwordSet")}
              </Link>
            </div>
          )}
          <div className="mt-6 border-t border-[var(--color-border)] pt-5">
            <p className="mb-3 text-base text-[var(--color-text-muted)]">{tMe("logoutHint")}</p>
            <LogoutButton />
          </div>
        </section>

        {/* Platform admins only: the way into approving sign-ups. The API
            sends is_super_admin to admins alone, so nobody else learns the
            page exists. */}
        {me?.user.is_super_admin && (
          <section className="card mt-6" aria-labelledby="admin-heading">
            <h2 id="admin-heading" className="text-lg font-semibold text-[var(--color-text)]">
              {tMe("adminHeading")}
            </h2>
            <p className="mt-1 text-base text-[var(--color-text-muted)]">{tMe("adminHint")}</p>
            <Link
              href={`/${locale}/admin`}
              data-testid="akun-admin-link"
              className="btn-base btn-secondary touch-target mt-4 w-full sm:w-auto"
            >
              {tMe("adminOpen")}
            </Link>
          </section>
        )}

        {/* Device preference, not account data: works even if the workspace
            failed to load. */}
        <AppearanceSetting
          initial={parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value)}
        />

        {loadFailed || !workspace ? (
          <p role="alert" className="card mt-6 p-6 text-base text-[var(--color-error-ink)]">
            {t("errorGeneric")}
          </p>
        ) : (
          <>
            {reminderPrefs && active && (
              <ReminderSettings workspaceId={active.id} initial={reminderPrefs} />
            )}
            {/* Only owners can change workspace settings. A caregiver used to
                see the whole form greyed out behind a "read-only" note. */}
            {isOwner && (
              <section aria-labelledby="workspace-settings-heading" className="mt-10">
                <h2
                  id="workspace-settings-heading"
                  className="mb-4 text-xl font-semibold text-[var(--color-text)]"
                >
                  {tMe("workspaceHeading")}
                </h2>
                <WorkspaceSettingsForm workspace={workspace} locale={locale} />
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
