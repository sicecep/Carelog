import Link from "next/link";

type Tab = "timeline" | "profile" | "tasks";

interface RecipientTabsProps {
  locale: string;
  recipientId: string;
  active: Tab;
  labels: { nav: string; timeline: string; profile: string; tasks: string };
}

/**
 * Segmented control for the recipient page: Linimasa / Profil / Tugas.
 *
 * Links, not ARIA tabs: each section is its own server-rendered URL
 * (`?tab=`), so the back button, sharing a link and a reload all land on the
 * same section, and only the visible section's data has to render. A nav
 * with `aria-current` is the honest semantics for that. No dependency.
 * Each segment is a 56px touch target; the active one is a raised surface
 * plus bold text, so it doesn't rest on colour alone.
 */
export function RecipientTabs({ locale, recipientId, active, labels }: RecipientTabsProps) {
  const base = `/${locale}/recipients/${recipientId}`;
  const tabs: { id: Tab; label: string; href: string }[] = [
    { id: "timeline", label: labels.timeline, href: base },
    { id: "profile", label: labels.profile, href: `${base}?tab=profile` },
    { id: "tasks", label: labels.tasks, href: `${base}?tab=tasks` },
  ];

  return (
    <nav aria-label={labels.nav} data-testid="recipient-tabs">
      <ul className="flex gap-1 rounded-xl bg-[var(--color-surface-hover)] p-1">
        {tabs.map((tab) => {
          const on = tab.id === active;
          return (
            <li key={tab.id} className="flex-1">
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                data-testid={`recipient-tab-${tab.id}`}
                className={`touch-target flex w-full items-center justify-center rounded-lg px-2 text-base transition-colors ${
                  on
                    ? "bg-[var(--color-surface)] font-semibold text-[var(--color-text)] shadow-[0_2px_6px_rgb(31_42_36/0.1)]"
                    : "font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
