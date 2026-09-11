import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppNav } from "@/components/ui/AppNav";
import { LogoutButton } from "@/app/[locale]/dashboard/logout-button";

interface AppHeaderProps {
  locale: string;
  /** Optional back link rendered before the logo (e.g. detail pages). */
  backHref?: string;
  backLabel?: string;
}

/**
 * Shared authenticated-page header: logo, inline nav on desktop, logout.
 * The mobile bottom tab bar is rendered by AppNav alongside this header.
 */
export async function AppHeader({ locale, backHref, backLabel }: AppHeaderProps) {
  const common = await getTranslations({ locale, namespace: "common" });

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              className="touch-target flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <span aria-hidden="true">&larr;</span>
              <span>{backLabel ?? common("back")}</span>
            </Link>
          )}
          <Link
            href={`/${locale}/dashboard`}
            className="text-lg font-semibold text-[var(--color-text)]"
          >
            {common("appName")}
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <AppNav locale={locale} />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
