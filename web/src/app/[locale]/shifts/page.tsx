import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  APIError,
  authApi,
  memberApi,
  shiftApi,
  workspaceApi,
  type Member,
  type ShiftRow,
} from "@/lib/api-client";
import { AppHeader } from "@/components/ui/AppHeader";
import { ShiftHistoryFilters } from "@/components/ui/ShiftHistoryFilters";
import { ShiftCard } from "@/components/ui/ShiftCard";

interface ShiftsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ caregiver?: string; from?: string; to?: string }>;
}

// SFT-004: shift history for the owner.
//
// A workspace-wide list of every check-in/check-out, filterable by
// caregiver and date range. Server component so the filters render with
// the correct dataset on first paint — filters preserved in URL params so
// bookmarks and back-button behaviour are natural.
export default async function ShiftsPage({ params, searchParams }: ShiftsPageProps) {
  const { locale } = await params;
  const { caregiver, from, to } = await searchParams;
  const t = await getTranslations({ locale, namespace: "shifts" });

  const forwarded = { Cookie: (await cookies()).toString() };

  let shifts: ShiftRow[] = [];
  let members: Member[] = [];
  let timezone = "Asia/Jakarta";
  let redirectToLogin = false;
  let notOwner = false;
  let loadFailed = false;

  try {
    const me = await authApi.me(undefined, forwarded);
    const workspace =
      me.data?.workspaces.find((w) => w.active) ?? me.data?.workspaces[0] ?? null;
    if (!workspace) redirect(`/${locale}/dashboard`);

    // Owner-only page: rather than let the API's 403 render as a broken
    // list, redirect a caregiver back to the dashboard. The API stays
    // authoritative — this is UX, not security.
    if (workspace.role !== "owner") {
      notOwner = true;
    } else {
      const [wsRes, membersRes, shiftsRes] = await Promise.allSettled([
        workspaceApi.get(workspace.id, forwarded),
        memberApi.list(workspace.id, forwarded),
        shiftApi.list(
          workspace.id,
          {
            caregiverId: caregiver,
            from,
            to,
          },
          forwarded,
        ),
      ]);
      if (wsRes.status === "fulfilled" && wsRes.value.data) {
        timezone = wsRes.value.data.timezone;
      }
      if (membersRes.status === "fulfilled") members = membersRes.value.data ?? [];
      if (shiftsRes.status === "fulfilled") shifts = shiftsRes.value.data ?? [];
    }
  } catch (err) {
    if (err instanceof APIError && err.status === 401) {
      redirectToLogin = true;
    } else {
      console.error("shifts page: load failed", err);
      loadFailed = true;
    }
  }

  if (redirectToLogin) redirect(`/${locale}/login`);
  if (notOwner) redirect(`/${locale}/dashboard`);

  // Only caregivers can appear in the filter — an owner in the dropdown
  // would return zero rows (owners don't check in) and read as a bug.
  const caregiverOptions = members
    .filter((m) => m.role === "caregiver" && m.is_active)
    .map((m) => ({
      id: m.user_id,
      // full_name is optional on Member; a phone-only caregiver needs a
      // fallback for the dropdown label just like the chip does.
      name: m.full_name || m.email || t("unknownCaregiver"),
    }));

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 md:pb-0">
      <AppHeader
        locale={locale}
        backHref={`/${locale}/dashboard`}
        backLabel={t("backLabel")}
      />

      <main className="mx-auto max-w-4xl px-4 py-8 pb-28 sm:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-medium text-[var(--color-text)]">
            {t("historyTitle")}
          </h1>
          <p className="mt-1 text-base text-[var(--color-text-muted)]">
            {t("historyBody")}
          </p>
        </header>

        <div className="mb-6">
          <ShiftHistoryFilters
            locale={locale}
            caregivers={caregiverOptions}
            selectedCaregiver={caregiver}
            from={from}
            to={to}
          />
        </div>

        {loadFailed ? (
          <p role="alert" className="card text-base text-[var(--color-error-ink)]">
            {t("loadError")}
          </p>
        ) : shifts.length === 0 ? (
          <div
            role="status"
            data-testid="shift-history-empty"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center"
          >
            <p className="text-base text-[var(--color-text)]">{t("historyEmpty")}</p>
          </div>
        ) : (
          <ul
            data-testid="shift-history-list"
            className="space-y-3"
          >
            {shifts.map((shift) => (
              <li key={shift.id}>
                <ShiftCard locale={locale} timezone={timezone} shift={shift} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
