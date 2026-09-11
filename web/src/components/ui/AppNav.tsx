"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  SquaresFour,
  UsersThree,
  UserCircleGear,
  GearSix,
} from "phosphor-react";

interface AppNavProps {
  locale: string;
}

// One source of truth for the tab set — same items and order in the desktop
// header and the mobile bottom bar. The tabs themselves are uniform across
// roles; owner-only affordances (Invite Caregiver, member management) live on
// the Care Team page and are hidden there for non-owners, matching the API's
// guards. This keeps the bar stable instead of reshuffling per role.
export function AppNav({ locale }: AppNavProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const tabs = [
    { href: `/${locale}/dashboard`, label: t("dashboard"), Icon: SquaresFour },
    { href: `/${locale}/recipients`, label: t("recipients"), Icon: UserCircleGear },
    { href: `/${locale}/careteam`, label: t("careteam"), Icon: UsersThree },
    { href: `/${locale}/settings`, label: t("settings"), Icon: GearSix },
  ];

  const isActive = (href: string) => pathname === href;

  return (
    <>
      {/* Desktop: inline in the header. */}
      <nav aria-label={t("ariaNav")} className="hidden md:block">
        <ul className="flex items-center gap-1">
          {tabs.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={`touch-target flex items-center gap-1.5 rounded-md px-3 text-sm font-medium ${
                  isActive(href)
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                <Icon size={18} weight={isActive(href) ? "fill" : "regular"} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile: bottom tab bar, in the thumb zone. */}
      <nav
        aria-label={t("ariaNav")}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden"
      >
        <ul className="mx-auto flex max-w-5xl">
          {tabs.map(({ href, label, Icon }) => (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1 ${
                  isActive(href)
                    ? "text-[var(--color-accent-ink)]"
                    : "text-[var(--color-text-muted)]"
                }`}
              >
                <Icon size={22} weight={isActive(href) ? "fill" : "regular"} aria-hidden="true" />
                <span className="text-xs">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
