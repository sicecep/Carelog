"use client";

// Client leaf: phosphor-react icons use React context, which a Server
// Component (AppHeader) can't render.

import Link from "next/link";
import { ArrowLeft } from "phosphor-react";

/** Back control for detail pages: a 56px labelled arrow on phones, a text
 *  link on desktop. */
export function AppBarBack({ href, label }: { href: string; label: string }) {
  return (
    <>
      <Link
        href={href}
        aria-label={label}
        className="touch-target inline-flex shrink-0 items-center justify-center rounded-full text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] md:hidden"
      >
        <ArrowLeft size={24} aria-hidden="true" />
      </Link>
      <Link
        href={href}
        className="touch-target hidden items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] md:inline-flex"
      >
        <ArrowLeft size={18} aria-hidden="true" />
        <span>{label}</span>
      </Link>
    </>
  );
}
