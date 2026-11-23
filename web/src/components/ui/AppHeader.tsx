import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppNav } from "@/components/ui/AppNav";
import { AppBarBack } from "@/components/ui/AppBarBack";

interface AppHeaderProps {
  locale: string;
  /** Detail pages: where the back button goes. */
  backHref?: string;
  /** Accessible name of the back button (it shows only an arrow). */
  backLabel?: string;
  /** Detail pages: the title shown next to the back button on phones. */
  title?: string;
  /**
   * "accent": on phones the bar is teal and flows into the page's teal hero
   * band (the "Hari Ini" home). Desktop keeps the plain surface bar.
   */
  tone?: "surface" | "accent";
}

/**
 * Shared authenticated-page app bar (DESIGN.md §8.11).
 *
 * Phones: an app-style bar. Top-level pages show the wordmark; detail pages
 * show a 56px back arrow and the page title, like a native app, instead of
 * a text link that wrapped onto two lines at 360px. Logout no longer lives
 * here — a one-tap "Keluar" in the top corner was the most prominent action
 * on every screen; it is now in the Akun tab.
 *
 * Desktop (md+): wordmark, the back link as text, and the inline tab nav.
 * The mobile bottom tab bar is rendered by AppNav alongside this header.
 */
export async function AppHeader({ locale, backHref, backLabel, title, tone = "surface" }: AppHeaderProps) {
  const common = await getTranslations({ locale, namespace: "common" });
  const back = backLabel ?? common("back");
  const accent = tone === "accent";

  return (
    <header
      className={`sticky top-0 z-10 border-b pt-[env(safe-area-inset-top)] md:border-[var(--color-border)] md:bg-[var(--color-surface)] ${
        accent
          ? "border-transparent bg-[var(--color-hero)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-2 px-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 md:gap-3">
          {backHref && <AppBarBack href={backHref} label={back} />}
          {backHref && title ? (
            <>
              {/* Phones: the page title in place of the wordmark. Not an
                  <h1>: the page keeps its own heading for screen readers. */}
              <span className="truncate px-1 text-xl font-semibold text-[var(--color-text)] md:hidden">
                {title}
              </span>
              <Wordmark locale={locale} label={common("appName")} className="hidden md:inline-flex" />
            </>
          ) : (
            <Wordmark
              locale={locale}
              label={common("appName")}
              className={`inline-flex px-2 md:px-0 ${accent ? "text-[var(--color-on-hero)] md:text-[var(--color-accent-ink)]" : ""}`}
            />
          )}
        </div>
        <AppNav locale={locale} />
      </div>
    </header>
  );
}

// The wordmark is a real navigation control (it routes to the dashboard), so
// it carries a full touch target rather than being exempted as decoration.
function Wordmark({ locale, label, className }: { locale: string; label: string; className: string }) {
  return (
    <Link
      href={`/${locale}/dashboard`}
      className={`touch-target items-center text-lg font-semibold ${
        className.includes("text-[") ? "" : "text-[var(--color-accent-ink)]"
      } ${className}`}
    >
      {label}
    </Link>
  );
}
