"use client";

import { useTranslations } from "next-intl";
import { Toaster as SonnerToaster } from "sonner";
import { CheckCircle } from "phosphor-react";

/**
 * App-wide toast region (DESIGN.md §8.7). Mounted once in the locale layout;
 * call `toast.success(...)` from `sonner` anywhere.
 *
 * Toasts are for short, non-blocking confirmations only ("Tersimpan",
 * "Link disalin"). Never for incidents, errors that need action, or access
 * revocation — those need a banner or a page state.
 *
 * `unstyled` drops Sonner's own look so the toast takes the design tokens
 * directly; layout, stacking, swipe and timing still come from Sonner.
 */
export function Toaster() {
  const t = useTranslations("common");

  return (
    <SonnerToaster
      position="bottom-center"
      duration={4000}
      containerAriaLabel={t("toastRegion")}
      // Mobile: clear the tallest fixed bottom bar plus a gap, and the home
      // indicator. That's the recipient page's action bar (Catat kegiatan /
      // Catat insiden): 12px padding + 56px button + 12px padding + 1px
      // border = 81px. 72px (sized for the 57px bottom nav) left the toast's
      // bottom edge 9px under that bar — measured in the running app.
      mobileOffset={{ bottom: "calc(96px + env(safe-area-inset-bottom))", left: "16px", right: "16px" }}
      icons={{ success: <CheckCircle size={20} weight="fill" aria-hidden="true" /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2 rounded-md border px-4 py-3 text-base font-medium shadow-[0_2px_6px_rgb(31_42_36/0.08)]",
          success:
            "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success-ink)]",
          default:
            "border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)]",
          icon: "shrink-0",
        },
      }}
    />
  );
}
