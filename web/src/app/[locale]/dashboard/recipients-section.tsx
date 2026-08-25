"use client";

// Client component only because phosphor-react icons read from IconContext via
// useContext, which Server Components can't call. There is no data fetching and
// no state here — recipients arrive as props from the server page.

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Baby, User, Users, Heart, UsersThree, Plus } from "phosphor-react";
import { CARE_TYPES, MODULES, type CareType, type Module } from "@/lib/constants.generated";
import type { Recipient } from "@/lib/api-client";

// Same care-type -> icon mapping as the onboarding chip (components/ui/Chip.tsx).
const careTypeIcons = {
  infant: Baby,
  child: User,
  elderly: Users,
  patient: Heart,
};

// Keep the pill row to one line on a narrow phone; the rest collapse into "+N".
const MAX_VISIBLE_MODULES = 4;

function isCareType(value: string): value is CareType {
  return (CARE_TYPES as readonly string[]).includes(value);
}

function isModule(value: string): value is Module {
  return (MODULES as readonly string[]).includes(value);
}

function RecipientCard({ recipient }: { recipient: Recipient }) {
  const t = useTranslations("dashboard");
  const tRecipients = useTranslations("recipients");
  const tOnboarding = useTranslations("onboarding");
  const locale = useLocale();

  const name = recipient.display_name?.trim() || recipient.full_name;
  const initial = name.trim().charAt(0).toUpperCase();

  const careType = isCareType(recipient.care_type) ? recipient.care_type : null;
  const CareIcon = careType ? careTypeIcons[careType] : null;

  // Drop anything the API sends that this build doesn't have a label for, rather
  // than letting next-intl raise on a missing key.
  const modules = (recipient.enabled_modules ?? []).filter(isModule);
  const visibleModules = modules.slice(0, MAX_VISIBLE_MODULES);
  const hiddenCount = modules.length - visibleModules.length;

  return (
    // TODO: /[locale]/recipients/[id] does not exist yet — this 404s until the
    // recipient detail route lands.
    <Link
      href={`/${locale}/recipients/${recipient.id}`}
      aria-label={t("openRecipient", { name })}
      className="card block h-full transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-lg font-semibold text-[var(--color-accent-ink)]"
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-medium text-[var(--color-text)]">{name}</h3>

          {careType && CareIcon && (
            <p className="mt-1 flex items-center gap-1.5 text-base text-[var(--color-text-muted)]">
              <CareIcon size={18} weight="thin" aria-hidden="true" />
              <span>{tRecipients(`careTypes.${careType}`)}</span>
            </p>
          )}
        </div>
      </div>

      {visibleModules.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {visibleModules.map((module) => (
            <li
              key={module}
              className="rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm text-[var(--color-accent-ink)]"
            >
              {tOnboarding(`modules.${module}`)}
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="rounded-full bg-[var(--color-surface-hover)] px-3 py-1 text-sm text-[var(--color-text-muted)]">
              {t("moreModules", { count: hiddenCount })}
            </li>
          )}
        </ul>
      )}
    </Link>
  );
}

function EmptyState() {
  const t = useTranslations("dashboard");
  const locale = useLocale();

  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-accent-soft)]"
      >
        <UsersThree size={40} weight="thin" className="text-[var(--color-accent)]" />
      </span>

      <h3 className="text-xl font-medium text-[var(--color-text)]">{t("emptyTitle")}</h3>
      <p className="mt-2 max-w-sm text-base text-[var(--color-text-muted)]">{t("emptyBody")}</p>

      <Link href={`/${locale}/onboarding`} className="btn-base btn-primary touch-target mt-6">
        <Plus size={20} weight="bold" aria-hidden="true" />
        <span>{t("emptyCta")}</span>
      </Link>
    </div>
  );
}

export function RecipientsSection({ recipients }: { recipients: Recipient[] }) {
  if (recipients.length === 0) return <EmptyState />;

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {recipients.map((recipient) => (
        <li key={recipient.id}>
          <RecipientCard recipient={recipient} />
        </li>
      ))}
    </ul>
  );
}
