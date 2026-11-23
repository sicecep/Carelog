import type { Viewport } from "next";
import type { ReactNode } from "react";

// Sign-in and sign-up pages open on the teal hero, so the phone's system bar
// takes the hero colour too (light/dark). Pages re-export this as `viewport`.
export const authViewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0E6B73" },
    { media: "(prefers-color-scheme: dark)", color: "#123A3D" },
  ],
};

interface AuthShellProps {
  appName: string;
  /** One line under the name; omit on pages where the content says it all. */
  tagline?: string;
  children: ReactNode;
}

/**
 * Layout for every screen before the app (login, register, pending, invite,
 * change password): a teal hero with the app mark and name, and a cream
 * sheet with rounded top corners holding the content (DESIGN.md §8.14).
 *
 * On phones it is full screen and the sheet fills the rest, so a form can
 * pin its main button to the bottom with `mt-auto` (thumb zone). From md it
 * becomes one centred card. Once a step is under way (a form, the PIN pad)
 * the page renders `<AuthCompact />` and the hero shrinks to one row — icon
 * and name, no tagline — so the keypad and its links fit on a 360×780
 * screen. A plain component — no hooks, no icon library —
 * so server and client pages can both use it.
 */
export function AuthShell({ appName, tagline, children }: AuthShellProps) {
  return (
    <div className="group flex min-h-dvh flex-col bg-[var(--color-hero)] text-[var(--color-on-hero)] md:items-center md:justify-center md:px-4 md:py-10">
      <div className="flex w-full flex-1 flex-col md:max-w-md md:flex-none md:overflow-hidden md:rounded-[28px] md:shadow-[0_16px_40px_rgb(0_0_0/0.25)]">
        <header className="px-6 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))] text-center group-has-[[data-auth-compact]]:flex group-has-[[data-auth-compact]]:items-center group-has-[[data-auth-compact]]:justify-center group-has-[[data-auth-compact]]:gap-3 group-has-[[data-auth-compact]]:pb-9 group-has-[[data-auth-compact]]:pt-[calc(1rem+env(safe-area-inset-top))]">
          <AppMark />
          <p className="mt-3 text-3xl font-bold tracking-tight group-has-[[data-auth-compact]]:mt-0 group-has-[[data-auth-compact]]:text-2xl">{appName}</p>
          {tagline && (
            <p className="mx-auto mt-2 max-w-xs text-base opacity-90 group-has-[[data-auth-compact]]:hidden">{tagline}</p>
          )}
        </header>
        <main className="-mt-6 flex flex-1 flex-col rounded-t-[28px] bg-[var(--color-bg)] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-7 text-[var(--color-text)] sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

/** The app icon (heart + kunyit dot), drawn inline so it needs no request. */
function AppMark() {
  return (
    <span
      aria-hidden="true"
      className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-[20px] bg-[var(--color-on-hero)] shadow-[0_8px_20px_rgb(0_0_0/0.18)] group-has-[[data-auth-compact]]:mx-0 group-has-[[data-auth-compact]]:h-11 group-has-[[data-auth-compact]]:w-11 group-has-[[data-auth-compact]]:rounded-[14px] group-has-[[data-auth-compact]]:shadow-none"
    >
      <svg viewBox="0 0 24 24" className="h-9 w-9 fill-[var(--color-hero)] group-has-[[data-auth-compact]]:h-6 group-has-[[data-auth-compact]]:w-6">
        <path d="M12 21s-6.7-4.4-9.3-8.1C.8 10.2 1.6 6.4 4.9 5.3c2-.7 4.1.1 5.3 1.8L12 9l1.8-1.9c1.2-1.7 3.3-2.5 5.3-1.8 3.3 1.1 4.1 4.9 2.2 7.6C18.7 16.6 12 21 12 21z" />
      </svg>
      <span className="absolute right-2.5 top-2.5 h-3 w-3 rounded-full bg-[var(--color-highlight)] group-has-[[data-auth-compact]]:right-1.5 group-has-[[data-auth-compact]]:top-1.5 group-has-[[data-auth-compact]]:h-2 group-has-[[data-auth-compact]]:w-2" />
    </span>
  );
}

/** Render inside an AuthShell to switch its hero to the compact row. */
export function AuthCompact() {
  return <span data-auth-compact hidden />;
}
