"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Heart, House, type Icon } from "phosphor-react";
import {
  type LoginRole,
  readLoginRole,
  subscribeLoginRole,
  writeLoginRole,
} from "@/lib/login-role";
import { OwnerLoginForm } from "./owner-login-form";
import { PinLoginForm } from "./pin-login-form";

interface LoginRoleChoiceProps {
  // Digits-only SUPPORT_WHATSAPP for the owner's "Lupa kata sandi?".
  supportWhatsApp?: string;
  // ?role= from the URL: opens that form directly (deep links, E2E). It
  // wins over the remembered choice for this visit but is not saved.
  initialRole?: LoginRole;
}

/**
 * The login screen asks one question first (login revamp §7): are you a
 * caregiver or family? Two large cards, then the matching form. The answer
 * is remembered so a return visit opens the form straight away, with
 * "Bukan Anda? Ganti" back to the choice.
 *
 * Bu Sari test: a returning caregiver sees the identifier field first, so
 * signing in is the identifier + PIN and nothing more.
 */
export function LoginRoleChoice({ supportWhatsApp, initialRole }: LoginRoleChoiceProps) {
  const t = useTranslations("auth");
  const locale = useLocale();
  // Server render has no storage, so it shows the choice (or ?role=); the
  // client then switches to the remembered form. useSyncExternalStore makes
  // that switch without a hydration mismatch.
  const remembered = useSyncExternalStore(subscribeLoginRole, readLoginRole, () => null);
  // "Ganti" on a ?role= link must show the choice even though the prop stays.
  const [ignoreInitial, setIgnoreInitial] = useState(false);
  const role = remembered ?? (ignoreInitial ? null : initialRole) ?? null;

  if (!role) {
    return (
      <div className="space-y-4">
        <h2 className="text-center text-xl font-semibold text-[var(--color-text)]">{t("whoAreYou")}</h2>
        <RoleCard
          icon={Heart}
          label={t("roleCaregiver")}
          hint={t("roleCaregiverHint")}
          onSelect={() => writeLoginRole("caregiver")}
        />
        <RoleCard
          icon={House}
          label={t("roleOwner")}
          hint={t("roleOwnerHint")}
          onSelect={() => writeLoginRole("owner")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--color-surface-hover)] px-4 py-1">
        <p className="min-w-0 text-base font-medium text-[var(--color-text)]">
          {role === "caregiver" ? t("roleCaregiverShort") : t("roleOwnerShort")}
        </p>
        <button
          type="button"
          // Forget the saved role too: on a shared tablet, "not you" means
          // the next person should not land on this form either.
          onClick={() => {
            setIgnoreInitial(true);
            writeLoginRole(null);
          }}
          className="touch-target shrink-0 text-base font-medium text-[var(--color-accent)] underline-offset-4 hover:underline"
        >
          {t("notYou")}
        </button>
      </div>

      {role === "caregiver" ? (
        <PinLoginForm />
      ) : (
        <>
          <OwnerLoginForm supportWhatsApp={supportWhatsApp} />
          <p className="text-center text-base text-[var(--color-text-muted)]">
            {t("noAccount")}{" "}
            <Link
              href={`/${locale}/register`}
              className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
            >
              {t("createAccount")}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

interface RoleCardProps {
  icon: Icon;
  label: string;
  hint: string;
  onSelect: () => void;
}

/** One of the two role cards: ≥ 96px tall, icon + label (spec §7). */
function RoleCard({ icon: IconComponent, label, hint, onSelect }: RoleCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-24 w-full items-center gap-4 rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-5 py-4 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
        <IconComponent size={30} weight="duotone" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold text-[var(--color-text)]">{label}</span>
        <span className="mt-0.5 block text-base text-[var(--color-text-muted)]">{hint}</span>
      </span>
    </button>
  );
}
