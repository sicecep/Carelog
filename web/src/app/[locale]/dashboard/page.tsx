import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  recipientApi,
  shiftApi,
  taskApi,
  notificationApi,
  type MeResponse,
  type Recipient,
  type ShiftRow,
  type Task,
  type Notification,
} from "@/lib/api-client";
import { AppHeader } from "@/components/ui/AppHeader";
import { RecipientsSection } from "./recipients-section";
import { HomeTasks } from "@/components/ui/HomeTasks";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { ShiftActions } from "@/components/ui/ShiftActions";

interface DashboardPageProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });

  // Fetched server-side rather than in a client effect. `credentials: "include"`
  // is a browser-only concept — a server fetch has no cookie jar — so the
  // incoming Cookie header is forwarded to the Go API explicitly. This works
  // because cookies are not scoped by port: cl_access, set by the API on
  // localhost:8080, is also sent to the Next server on localhost:3000.
  const forwarded = { Cookie: (await cookies()).toString() };

  let me: MeResponse | null = null;
  let recipients: Recipient[] = [];
  let myTasks: Task[] = [];
  let notifications: Notification[] = [];
  let unreadCount = 0;
  let activeShift: ShiftRow | undefined;
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
      const [activeRes, archivedRes, tasksRes, notifRes, shiftRes] = await Promise.all([
        recipientApi.list(workspace.id, forwarded),
        recipientApi.listArchived(workspace.id, forwarded),
        // TSK-002 home-screen section and NOT-002 bell. Non-fatal: the
        // dashboard's primary job is the recipient list, and a task or
        // notification failure must not blank it.
        taskApi.listMine(workspace.id, forwarded).catch(() => null),
        notificationApi.list(workspace.id, forwarded).catch(() => null),
        // SFT-001: the caller's open shift, if any. 404 is the normal
        // "not on shift" answer, so it is swallowed rather than treated
        // as a failure. Only fetched for caregivers — an owner never
        // checks in and would always 404.
        workspace.role === "caregiver"
          ? shiftApi.getActive(workspace.id, forwarded).catch(() => null)
          : Promise.resolve(null),
      ]);
      // Dedupe by id: the two endpoints are independent queries, so a row that
      // flips is_active between the two round-trips can land in both results.
      // React then renders duplicate keys and may drop or duplicate a card.
      // Active wins — it reflects the newer state.
      const byId = new Map<string, (typeof recipients)[number]>();
      for (const r of archivedRes.data ?? []) byId.set(r.id, r);
      for (const r of activeRes.data ?? []) byId.set(r.id, r);
      recipients = [...byId.values()];

      myTasks = tasksRes?.data ?? [];
      notifications = notifRes?.data?.notifications ?? [];
      unreadCount = notifRes?.data?.unread_count ?? 0;
      activeShift = shiftRes?.data ?? undefined;
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
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader locale={locale} />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {me ? (
          <>
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
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
              {/* NOT-002: the bell lives beside the greeting rather than in
                  AppHeader, which is a server component shared by every page
                  and has no workspace-scoped data to hand it. */}
              {workspace && (
                <NotificationBell
                  workspaceId={workspace.id}
                  locale={locale}
                  initial={notifications}
                  initialUnread={unreadCount}
                />
              )}
            </div>

            {/* SFT-001 / SFT-002: caregivers only. The PRD is explicit that
                owners log entries without a shift and are never prompted to
                check in, so this renders for the caregiver role alone.
                Placed above tasks: starting the shift precedes doing the
                work it covers. */}
            {workspace && workspace.role === "caregiver" && me?.user.id && (
              <div className="mb-6">
                <ShiftActions
                  workspaceId={workspace.id}
                  caregiverId={me.user.id}
                  active={activeShift}
                />
              </div>
            )}

            {/* TSK-002: tasks on the home screen, sorted by due time. Placed
                ABOVE the recipient list — an assigned task is the thing a
                caregiver opens the app to act on. */}
            {workspace && (
              <div className="mb-8">
                <HomeTasks
                  workspaceId={workspace.id}
                  locale={locale}
                  tasks={myTasks}
                  isOwner={workspace.role === "owner"}
                />
              </div>
            )}

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
