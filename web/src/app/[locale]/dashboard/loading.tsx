import { getTranslations } from "next-intl/server";

const SKELETON_CARDS = 3;

// Route-segment loading UI. The dashboard fetches on the server, so this is what
// shows while that request is in flight instead of a client-side spinner.
export default async function DashboardLoading() {
  const t = await getTranslations("dashboard");

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
          <div className="skeleton h-6 w-28 rounded-md" />
        </div>
      </header>

      <main
        className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
        role="status"
        aria-busy="true"
        aria-label={t("loadingRecipients")}
      >
        <div className="mb-8">
          <div className="skeleton h-8 w-64 rounded-md" />
          <div className="skeleton mt-2 h-6 w-32 rounded-full" />
        </div>

        <div className="skeleton mb-4 h-7 w-48 rounded-md" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <div key={i} className="card" aria-hidden="true">
              <div className="flex items-start gap-4">
                <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="skeleton h-6 w-3/4 rounded-md" />
                  <div className="skeleton mt-2 h-5 w-1/2 rounded-md" />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <div className="skeleton h-7 w-16 rounded-full" />
                <div className="skeleton h-7 w-20 rounded-full" />
                <div className="skeleton h-7 w-14 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
