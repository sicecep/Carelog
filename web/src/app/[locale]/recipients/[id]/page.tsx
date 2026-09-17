import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  assignmentApi,
  authApi,
  incidentApi,
  memberApi,
  recipientApi,
  shiftApi,
  taskApi,
  workspaceApi,
  type AssignedCaregiver,
  type Incident,
  type Member,
  type Recipient,
  type ReportEntry,
  type ShiftRow,
  type Task,
} from "@/lib/api-client";
import { PLAN_LIMITS } from "@/lib/constants.generated";
import { DetailActions } from "./detail-actions";
import { DaySummaryTrigger, DetailHeader, TimelineList } from "./detail-sections";
import { AppHeader } from "@/components/ui/AppHeader";
import { ContributorChips } from "@/components/ui/ContributorChips";
import { DateNav } from "@/components/ui/DateNav";
import { ParentNotes } from "@/components/ui/ParentNotes";
import { ShiftCard } from "@/components/ui/ShiftCard";
import { AssignmentManager } from "@/components/ui/AssignmentManager";
import { TaskManager } from "@/components/ui/TaskManager";

interface RecipientPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ date?: string; contributor?: string }>;
}

/** YYYY-MM-DD for `now` rendered in the given IANA timezone. */
function dayInTimezone(now: Date, timezone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the wire format — and
    // Intl does the zone conversion correctly, unlike hand-rolled offset math.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Shift a YYYY-MM-DD string by whole days without local-timezone drift. */
function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

export default async function RecipientDetailPage({
  params,
  searchParams,
}: RecipientPageProps) {
  const { locale, id } = await params;
  const { date: dateParam, contributor: contributorParam } = await searchParams;
  const t = await getTranslations({ locale, namespace: "recipients" });
  const tTimeline = await getTranslations({ locale, namespace: "timeline" });

  // Server Component fetch: forward the incoming Cookie header explicitly —
  // a server-side fetch has no cookie jar (same pattern as the dashboard).
  const forwarded = { Cookie: (await cookies()).toString() };

  let recipient: Recipient | null = null;
  let entries: ReportEntry[] = [];
  let incidents: Incident[] = [];
  let workspaceId: string | null = null;
  let isOwner = false;
  let canWrite = false;
  let assignments: AssignedCaregiver[] = [];
  let members: Member[] = [];
  let tasks: Task[] = [];
  let shifts: ShiftRow[] = [];
  let workspaceTimezone = "Asia/Jakarta";
  let currentUserId = "";
  let redirectToLogin = false;
  let notFound = false;
  let loadFailed = false;
  // RPT-003 / OWN-009 date browsing state.
  let today = new Date().toISOString().slice(0, 10);
  let viewDate = today;
  let minDate: string | undefined;
  let historyGated = false;

  try {
    const me = await authApi.me(undefined, forwarded);
    const workspace =
      me.data?.workspaces.find((w) => w.active) ?? me.data?.workspaces[0] ?? null;
    if (!workspace) redirect(`/${locale}/dashboard`);
    workspaceId = workspace.id;
    isOwner = workspace.role === "owner";
    // CGR-007: the day-end summary trigger is a writer control — the API
    // 403s viewers, so the button is hidden (not disabled) for them.
    canWrite = workspace.role === "owner" || workspace.role === "caregiver";
    currentUserId = me.data?.user.id ?? "";

    // RPT-003: plan + timezone drive both "today" and the reachable window.
    // A failure here must not break the page — fall back to unlimited
    // browsing and let the API be the authority (it gates server-side).
    try {
      const wsRes = await workspaceApi.get(workspace.id, forwarded);
      const ws = wsRes.data;
      if (ws) {
        today = dayInTimezone(new Date(), ws.timezone);
        workspaceTimezone = ws.timezone;
        const limit = PLAN_LIMITS[ws.plan as keyof typeof PLAN_LIMITS];
        const historyDays = limit?.historyDays;
        if (historyDays != null) {
          // Window is inclusive of today, so N days reaches back N-1.
          minDate = shiftDay(today, -(historyDays - 1));
        }
      }
    } catch (err) {
      console.error("recipient detail: workspace load failed", err);
    }

    // Clamp the requested date: a malformed or future ?date= should land on
    // today rather than rendering an empty page with a broken nav.
    viewDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today
        ? dateParam
        : today;

    const res = await recipientApi.get(workspace.id, id, forwarded);
    recipient = res.data;

    if (recipient) {
      // Timeline, incidents, assignments, members, tasks, and shifts are
      // non-fatal: the profile still renders if any of these fails. Shifts
      // are owner-only on the API — a caregiver's request 403s and the
      // rejection is absorbed here so the timeline continues to render for
      // them without the shift cards.
      const [
        entriesRes,
        incidentsRes,
        assignmentsRes,
        membersRes,
        tasksRes,
        shiftsRes,
      ] = await Promise.allSettled([
        recipientApi.getTimeline(workspace.id, id, viewDate, forwarded),
        incidentApi.listForRecipient(workspace.id, id, viewDate, forwarded),
        assignmentApi.list(workspace.id, id, forwarded),
        memberApi.list(workspace.id, forwarded),
        taskApi.listForRecipient(workspace.id, id, forwarded),
        isOwner
          ? shiftApi.list(workspace.id, { date: viewDate }, forwarded)
          : Promise.resolve({ data: [] as ShiftRow[] }),
      ]);
      if (entriesRes.status === "fulfilled") entries = entriesRes.value.data ?? [];
      if (incidentsRes.status === "fulfilled") incidents = incidentsRes.value.data ?? [];
      if (assignmentsRes.status === "fulfilled") assignments = assignmentsRes.value.data ?? [];
      if (membersRes.status === "fulfilled") members = membersRes.value.data ?? [];
      if (tasksRes.status === "fulfilled") tasks = tasksRes.value.data ?? [];
      if (shiftsRes.status === "fulfilled") shifts = shiftsRes.value.data ?? [];

      // The API is the authority on the history window: a 403 here means the
      // requested day is behind the plan's paywall. Detected from the real
      // rejection rather than trusting the client-side minDate, so a stale
      // plan constant can never leak data the server refused.
      const gatedReason = (r: PromiseSettledResult<unknown>) =>
        r.status === "rejected" &&
        r.reason instanceof APIError &&
        r.reason.status === 403 &&
        r.reason.code === "upgrade_required";
      historyGated = gatedReason(entriesRes) || gatedReason(incidentsRes);
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

  // RPT-002: derive contributor chips from the day's actual activity.
  // Building this from the SAME payload the timeline renders keeps the
  // chip set impossible to disagree with the entries below (no ghost chip
  // for a contributor whose entries were filtered out server-side, no
  // missing chip for a contributor whose entry is visible). Order by first
  // occurrence so the chips read chronologically alongside the timeline.
  const contributors: Array<{ id: string; name: string }> = [];
  const seenContribIds = new Set<string>();
  for (const e of entries) {
    if (!e.contributor_id || seenContribIds.has(e.contributor_id)) continue;
    seenContribIds.add(e.contributor_id);
    contributors.push({ id: e.contributor_id, name: e.contributor_name });
  }
  for (const i of incidents) {
    if (!i.reporter_id || seenContribIds.has(i.reporter_id)) continue;
    seenContribIds.add(i.reporter_id);
    contributors.push({ id: i.reporter_id, name: i.reporter_name ?? "" });
  }

  // Filter the timeline to the selected contributor. A ?contributor= that
  // doesn't match anyone falls back to "All" — a stale shared URL should
  // not render an empty page it can't recover from with the UI alone.
  const activeContributorId =
    contributorParam && seenContribIds.has(contributorParam)
      ? contributorParam
      : undefined;
  const filteredEntries = activeContributorId
    ? entries.filter((e) => e.contributor_id === activeContributorId)
    : entries;
  const filteredIncidents = activeContributorId
    ? incidents.filter((i) => i.reporter_id === activeContributorId)
    : incidents;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader
        locale={locale}
        backHref={`/${locale}/dashboard`}
        backLabel={t("detailBack")}
      />

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

            {/* OWN-004 / OWN-005: standing instructions + today's note.
                Rendered ABOVE the timeline so a caregiver reads the parent's
                instructions before logging anything. Owners get the editor;
                caregivers and viewers get a read-only panel. */}
            {workspaceId && (
              <div className="mt-6">
                <ParentNotes
                  recipientId={id}
                  workspaceId={workspaceId}
                  canEdit={isOwner}
                />
              </div>
            )}

            {/* OWN-008A/B/C/D: who cares for this child — owner can assign
                and revoke per recipient; everyone sees the current team. */}
            {workspaceId && (
              <div className="mt-6">
                <AssignmentManager
                  recipientId={id}
                  workspaceId={workspaceId}
                  canManage={isOwner}
                  assigned={assignments}
                  members={members}
                />
              </div>
            )}

            {/* OWN-006 / TSK-001 / TSK-002: owner assigns tasks to assigned
                caregivers and tracks completion; a caregiver viewing this
                profile can advance their own tasks. Assignable list is the
                active care team, so a task can never be assigned to someone
                who cannot open the profile. */}
            {workspaceId && (
              <div className="mt-6">
                <TaskManager
                  recipientId={id}
                  workspaceId={workspaceId}
                  canManage={isOwner}
                  tasks={tasks}
                  assignable={assignments}
                  currentUserId={currentUserId}
                />
              </div>
            )}

            <section aria-labelledby="timeline-heading" className="mt-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="timeline-heading"
                  className="text-xl font-medium text-[var(--color-text)]"
                >
                  {t("detailTimelineHeading")}
                </h2>
                {workspaceId && canWrite && (
                  <DaySummaryTrigger
                    recipientId={recipient.id}
                    workspaceId={workspaceId}
                    modules={recipient.enabled_modules}
                  />
                )}
              </div>

              {/* RPT-003 / OWN-009: date navigation. Prev/next stay
                  visible even at boundaries (disabled, not hidden) so a
                  Free-plan owner sees that older days exist. */}
              <div className="mb-4">
                <DateNav
                  locale={locale}
                  recipientId={recipient.id}
                  date={viewDate}
                  today={today}
                  minDate={minDate}
                />
              </div>

              {/* RPT-002: contributor chips render only when the day has
                  more than one contributor. Hidden by the component itself
                  otherwise — noise for the common case of one caregiver on
                  a shift. */}
              {!historyGated && contributors.length > 0 && (
                <div className="mb-4">
                  <ContributorChips
                    locale={locale}
                    recipientId={recipient.id}
                    contributors={contributors}
                    activeContributorId={activeContributorId}
                    date={viewDate}
                  />
                </div>
              )}

              {!historyGated &&
                shifts.length > 0 &&
                filteredEntries.length + filteredIncidents.length + shifts.length > 0 && (
                  <section
                    aria-label={tTimeline("shiftsSectionLabel")}
                    data-testid="shift-cards-section"
                    className="mb-6 space-y-3"
                  >
                    {/* RPT-004: one card per caregiver who checked in that
                        day. The PRD asks for INLINE placement at the
                        check-in timestamp; we render them as a chronological
                        block just above the entries because TimelineList is
                        a client component and ShiftCard is a server component,
                        so a true inline merge would force one of them to
                        change tier. Sorted by check-in, which preserves the
                        chronological reading order that "inline" was really
                        about. */}
                    {[...shifts]
                      .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at))
                      // A caregiver-chip filter narrows shifts too so the
                      // page reads consistently: "show me only this person"
                      // means their entries AND their shift.
                      .filter(
                        (s) =>
                          !activeContributorId ||
                          s.caregiver_id === activeContributorId,
                      )
                      .map((shift) => (
                        <ShiftCard
                          key={shift.id}
                          locale={locale}
                          timezone={workspaceTimezone}
                          shift={shift}
                        />
                      ))}
                  </section>
                )}

              {historyGated ? (
                // The server refused this day. Show WHY, not a blank page:
                // "there's nothing here" would read as a caregiver bug.
                <div
                  role="status"
                  data-testid="timeline-gated"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center"
                >
                  <p className="text-base font-medium text-amber-900">
                    {tTimeline("gatedTitle")}
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    {tTimeline("gatedBody")}
                  </p>
                </div>
              ) : filteredEntries.length === 0 && filteredIncidents.length === 0 ? (
                <div
                  role="status"
                  data-testid="timeline-empty"
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center"
                >
                  <p className="text-base text-[var(--color-text)]">
                    {activeContributorId
                      ? tTimeline("emptyForContributor")
                      : viewDate === today
                      ? tTimeline("emptyToday")
                      : tTimeline("emptyPast")}
                  </p>
                </div>
              ) : (
                <TimelineList
                  entries={filteredEntries}
                  incidents={filteredIncidents}
                  isOwner={isOwner}
                  workspaceId={workspaceId!}
                />
              )}
            </section>

            {workspaceId && (
              <DetailActions recipientId={recipient.id} workspaceId={workspaceId} recipient={recipient} />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
