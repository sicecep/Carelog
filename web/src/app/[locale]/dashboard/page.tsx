import Link from "next/link";
import type { Viewport } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  api,
  authApi,
  incidentApi,
  recipientApi,
  shiftApi,
  taskApi,
  notificationApi,
  workspaceApi,
  type Incident,
  type MeResponse,
  type Recipient,
  type ReportEntry,
  type ShiftRow,
  type Task,
  type Notification,
} from "@/lib/api-client";
import { AppHeader } from "@/components/ui/AppHeader";
import { EmptyState } from "./recipients-section";
import { QuickLog, RecipientTodayCard, type RecipientTodaySummary } from "./today-client";
import { HomeTasks } from "@/components/ui/HomeTasks";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { ShiftActions } from "@/components/ui/ShiftActions";
import { TimelineList } from "../recipients/[id]/detail-sections";
import { DEFAULT_TIMEZONE, formatClock } from "@/lib/format-time";
import { dayInTimezone } from "@/lib/day";
import { MODULES, type LogCategory, type Module } from "@/lib/constants.generated";

interface DashboardPageProps {
  params: Promise<{ locale: string }>;
  /** `r`: the recipient a caregiver is looking at (switcher). */
  searchParams: Promise<{ r?: string }>;
}

// The home screen opens on a teal hero band, so the phone's system bar takes
// the accent too and the top of the screen reads as one surface.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0E6B73" },
    { media: "(prefers-color-scheme: dark)", color: "#123A3D" },
  ],
};

// How many of today's entries the home screen previews; the rest are one tap
// away on the recipient's timeline.
const RECENT_ENTRIES = 3;

interface ParentNote {
  note_type: "standing" | "daily";
  content: string;
}

const isModule = (m: string): m is Module => (MODULES as readonly string[]).includes(m);
const nameOf = (r: Recipient) => r.display_name?.trim() || r.full_name;

/** Latest occurred_at per category, formatted as a wall-clock time. */
function lastLoggedByCategory(
  entries: ReportEntry[],
  locale: string,
  timezone: string
): Partial<Record<LogCategory, string>> {
  const latest: Partial<Record<LogCategory, string>> = {};
  for (const e of entries) {
    const prev = latest[e.category];
    if (!prev || e.occurred_at > prev) latest[e.category] = e.occurred_at;
  }
  const out: Partial<Record<LogCategory, string>> = {};
  for (const [cat, iso] of Object.entries(latest) as [LogCategory, string][]) {
    out[cat] = formatClock(iso, locale, timezone);
  }
  return out;
}

const SEVERITY_ORDER = ["low", "medium", "high", "emergency"] as const;
function topSeverity(incidents: Incident[]): RecipientTodaySummary["topSeverity"] {
  let top = -1;
  for (const i of incidents) top = Math.max(top, SEVERITY_ORDER.indexOf(i.severity));
  return top >= 0 ? SEVERITY_ORDER[top] : undefined;
}

/**
 * "Hari Ini" — the home screen (UI revamp phase 2, DESIGN.md §8.13).
 *
 * Caregiver: today for one recipient — recipient switcher, shift, the
 * owner's standing instruction, quick-log tiles that open straight on a
 * category, and today's latest entries. Owner: one card per recipient with
 * today at a glance, plus who is on duty. Both keep the tasks list.
 */
export default async function DashboardPage({ params, searchParams }: DashboardPageProps) {
  const { locale } = await params;
  const { r: selectedParam } = await searchParams;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const tToday = await getTranslations({ locale, namespace: "today" });

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
  let workspaceTimezone = DEFAULT_TIMEZONE;
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

  // An owner on an admin-issued temporary password can't use the app until
  // they set their own: the API answers password_change_required everywhere
  // else, so send them straight to the change screen instead of showing a
  // load error (login revamp §4.5).
  const mustChangePassword = me?.auth?.password_change_required ?? false;

  // A user always has at least one workspace once onboarding has run; `active`
  // marks the one to scope this session to.
  const workspace = me?.workspaces.find((w) => w.active) ?? me?.workspaces[0] ?? null;
  const isOwner = workspace?.role === "owner";
  const isCaregiver = workspace?.role === "caregiver";

  if (workspace && !mustChangePassword) {
    try {
      const [activeRes, archivedRes, tasksRes, notifRes, shiftRes, settingsRes] = await Promise.all([
        recipientApi.list(workspace.id, forwarded),
        recipientApi.listArchived(workspace.id, forwarded),
        // TSK-002 home-screen section and NOT-002 bell. Non-fatal: a task or
        // notification failure must not blank the home screen.
        taskApi.listMine(workspace.id, forwarded).catch(() => null),
        notificationApi.list(workspace.id, forwarded).catch(() => null),
        // SFT-001: the caller's open shift, if any. 404 is the normal
        // "not on shift" answer, so it is swallowed rather than treated
        // as a failure. Only fetched for caregivers — an owner never
        // checks in and would always 404.
        isCaregiver
          ? shiftApi.getActive(workspace.id, forwarded).catch(() => null)
          : Promise.resolve(null),
        // "Today" and every time on the page are in the workspace's zone
        // (not the server's or the phone's). Non-fatal: falls back to
        // DEFAULT_TIMEZONE.
        workspaceApi.get(workspace.id, forwarded).catch(() => null),
      ]);
      // Dedupe by id: the two endpoints are independent queries, so a row that
      // flips is_active between the two round-trips can land in both results.
      // Active wins — it reflects the newer state.
      const byId = new Map<string, Recipient>();
      for (const r of archivedRes.data ?? []) byId.set(r.id, r);
      for (const r of activeRes.data ?? []) byId.set(r.id, r);
      recipients = [...byId.values()];

      myTasks = tasksRes?.data ?? [];
      notifications = notifRes?.data?.notifications ?? [];
      unreadCount = notifRes?.data?.unread_count ?? 0;
      activeShift = shiftRes?.data ?? undefined;
      workspaceTimezone = settingsRes?.data?.timezone ?? DEFAULT_TIMEZONE;
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
  if (mustChangePassword) redirect(`/${locale}/change-password`);

  const today = dayInTimezone(new Date(), workspaceTimezone);
  const todayLabel = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: workspaceTimezone,
  }).format(new Date());

  const active = recipients.filter((r) => r.is_active);
  const displayName = me?.user.full_name?.trim() || me?.user.email.split("@")[0] || "";

  // ── Today's data ────────────────────────────────────────────────────────
  // Every fetch below is non-fatal: a missing timeline must not blank the
  // home screen, it just shows fewer numbers.
  const selected = isOwner ? undefined : (active.find((r) => r.id === selectedParam) ?? active[0]);
  let selectedEntries: ReportEntry[] = [];
  let selectedIncidents: Incident[] = [];
  let standingNote = "";
  let summaries: RecipientTodaySummary[] = [];
  let onDuty: string[] = [];

  if (workspace && selected) {
    const [entriesRes, incidentsRes, notesRes] = await Promise.allSettled([
      recipientApi.getTimeline(workspace.id, selected.id, today, forwarded),
      incidentApi.listForRecipient(workspace.id, selected.id, today, forwarded),
      api.get<ParentNote[]>(`/api/v1/recipients/${selected.id}/notes`, {
        "X-Workspace-ID": workspace.id,
        ...forwarded,
      }),
    ]);
    if (entriesRes.status === "fulfilled") selectedEntries = entriesRes.value.data ?? [];
    if (incidentsRes.status === "fulfilled") selectedIncidents = incidentsRes.value.data ?? [];
    if (notesRes.status === "fulfilled") {
      standingNote =
        (notesRes.value.data ?? []).find((n) => n.note_type === "standing")?.content.trim() ?? "";
    }
  }

  if (workspace && isOwner && active.length > 0) {
    const perRecipient = await Promise.all(
      active.map(async (r) => {
        const [entriesRes, incidentsRes] = await Promise.allSettled([
          recipientApi.getTimeline(workspace.id, r.id, today, forwarded),
          incidentApi.listForRecipient(workspace.id, r.id, today, forwarded),
        ]);
        const entries = entriesRes.status === "fulfilled" ? (entriesRes.value.data ?? []) : [];
        const incidents = incidentsRes.status === "fulfilled" ? (incidentsRes.value.data ?? []) : [];
        const last = lastLoggedByCategory(entries, locale, workspaceTimezone);
        return {
          id: r.id,
          name: nameOf(r),
          lastMeal: last.meal,
          lastMedication: last.medication,
          entryCount: entries.length,
          incidentCount: incidents.length,
          topSeverity: topSeverity(incidents),
        } satisfies RecipientTodaySummary;
      })
    );
    summaries = perRecipient;
    // Shifts are workspace-wide (a caregiver isn't on shift "for" one
    // recipient), so who is on duty is one line in the hero, not per card.
    const shifts = await shiftApi.list(workspace.id, { date: today }, forwarded).catch(() => null);
    onDuty = [
      ...new Set((shifts?.data ?? []).filter((s) => !s.checked_out_at).map((s) => s.caregiver_name)),
    ];
  }

  const recentEntries = [...selectedEntries]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, RECENT_ENTRIES);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 md:pb-0">
      <AppHeader locale={locale} tone="accent" />

      {me ? (
        <>
          {/* Hero band: who/when, the bell and (caregivers) the recipient
              switcher and shift. Teal flows on from the app bar on phones. */}
          <section className="rounded-b-[28px] bg-[var(--color-hero)] text-[var(--color-on-hero)] md:rounded-none md:bg-transparent md:text-[var(--color-text)]">
            <div className="mx-auto max-w-5xl px-4 pb-6 pt-2 sm:px-6 md:pt-8">
              <div className="flex items-start justify-between gap-4">
                {/* min-w-0 + wrap-anywhere: a name with no spaces must not
                    push the bell off a 360px screen. */}
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold wrap-anywhere">
                    {isOwner ? tToday("greetingOwner", { name: displayName }) : tToday("title")}
                  </h1>
                  <p className="mt-1 text-base opacity-90">{todayLabel}</p>
                  {isOwner && (
                    <p className="mt-1 text-base opacity-90 wrap-anywhere">
                      {onDuty.length > 0
                        ? tToday("onDuty", { names: onDuty.join(", ") })
                        : tToday("nobodyOnDuty")}
                    </p>
                  )}
                </div>
                {/* NOT-002: the bell sits here rather than in AppHeader,
                    which is shared by every page and has no
                    workspace-scoped data to hand it. */}
                {workspace && (
                  <div className="shrink-0">
                    <NotificationBell
                      workspaceId={workspace.id}
                      locale={locale}
                      initial={notifications}
                      initialUnread={unreadCount}
                    />
                  </div>
                )}
              </div>

              {!isOwner && active.length > 1 && selected && (
                <nav aria-label={tToday("switcherLabel")} className="mt-5">
                  <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                    {active.map((r) => {
                      const on = r.id === selected.id;
                      const name = nameOf(r);
                      return (
                        <li key={r.id} className="shrink-0">
                          <Link
                            href={`/${locale}/dashboard?r=${r.id}`}
                            aria-current={on ? "true" : undefined}
                            className="flex w-20 flex-col items-center gap-1 text-center"
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-semibold ${
                                on
                                  ? "bg-[var(--color-surface)] text-[var(--color-accent-ink)] ring-[3px] ring-[var(--color-highlight)] ring-offset-2 ring-offset-[var(--color-hero)] md:ring-offset-[var(--color-bg)]"
                                  : "bg-[var(--color-on-hero)]/15 md:bg-[var(--color-accent-soft)] md:text-[var(--color-accent-ink)]"
                              }`}
                            >
                              {name.trim().charAt(0).toUpperCase()}
                            </span>
                            <span className={`w-full truncate text-base ${on ? "font-semibold" : "opacity-90"}`}>
                              {name}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              )}

              {/* SFT-001 / SFT-002: caregivers only. The PRD is explicit that
                  owners log entries without a shift and are never prompted
                  to check in. */}
              {workspace && isCaregiver && me.user.id && (
                <div className="mt-5 text-[var(--color-text)]">
                  <ShiftActions
                    workspaceId={workspace.id}
                    caregiverId={me.user.id}
                    active={activeShift}
                    timezone={workspaceTimezone}
                  />
                </div>
              )}
            </div>
          </section>

          <main className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
            {loadFailed ? (
              <p role="alert" className="card text-base text-[var(--color-error-ink)]">
                {t("loadError")}
              </p>
            ) : (
              <>
                {/* Caregiver / viewer: today for the selected recipient. */}
                {!isOwner && workspace && selected && (
                  <>
                    {standingNote && (
                      <aside
                        aria-label={tToday("standingNote")}
                        className="rounded-md border-l-4 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-3 text-base whitespace-pre-line text-[var(--color-accent-ink)]"
                      >
                        {standingNote}
                      </aside>
                    )}

                    {workspace.role !== "viewer" && (
                      <QuickLog
                        recipientId={selected.id}
                        recipientName={nameOf(selected)}
                        workspaceId={workspace.id}
                        modules={(selected.enabled_modules ?? []).filter(isModule)}
                        lastLogged={lastLoggedByCategory(selectedEntries, locale, workspaceTimezone)}
                        shiftPrompt={
                          isCaregiver
                            ? { caregiverId: me.user.id, offShift: !activeShift }
                            : undefined
                        }
                      />
                    )}

                    <section aria-labelledby="recent-heading">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h2 id="recent-heading" className="text-xl font-semibold text-[var(--color-text)]">
                          {tToday("recentHeading")}
                        </h2>
                        <Link
                          href={`/${locale}/recipients/${selected.id}`}
                          className="touch-target inline-flex items-center px-2 text-base font-medium text-[var(--color-accent)]"
                        >
                          {tToday("seeAll")}
                        </Link>
                      </div>
                      {recentEntries.length === 0 && selectedIncidents.length === 0 ? (
                        <p className="card text-base text-[var(--color-text-muted)]">{tToday("emptyToday")}</p>
                      ) : (
                        <TimelineList
                          entries={recentEntries}
                          incidents={selectedIncidents}
                          isOwner={false}
                          workspaceId={workspace.id}
                          timezone={workspaceTimezone}
                        />
                      )}
                    </section>
                  </>
                )}

                {!isOwner && active.length === 0 && (
                  <p className="card text-base text-[var(--color-text-muted)]">
                    {tToday("noRecipientsCaregiver")}
                  </p>
                )}

                {/* Owner: today at a glance, one card per recipient. The
                    full list (with archive/restore) is the Terawat tab. */}
                {isOwner && (
                  <section aria-labelledby="recipients-heading">
                    <h2 id="recipients-heading" className="mb-3 text-xl font-semibold text-[var(--color-text)]">
                      {t("recipientsHeading")}
                    </h2>
                    {active.length === 0 ? (
                      <EmptyState />
                    ) : (
                      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {summaries.map((s) => (
                          <li key={s.id}>
                            <RecipientTodayCard summary={s} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {/* TSK-002: the caller's tasks, sorted by due time. */}
                {workspace && (
                  <HomeTasks
                    workspaceId={workspace.id}
                    locale={locale}
                    tasks={myTasks}
                    isOwner={isOwner}
                  />
                )}
              </>
            )}
          </main>
        </>
      ) : (
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <p role="alert" className="card text-base text-[var(--color-error-ink)]">
            {t("loadError")}
          </p>
        </main>
      )}
    </div>
  );
}
