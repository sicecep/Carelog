"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CaretRight, Heart, House, type Icon } from "phosphor-react";
import {
  type LoginRole,
  readLoginRole,
  subscribeLoginRole,
  writeLoginRole,
} from "@/lib/login-role";
import { OwnerLoginForm } from "./owner-login-form";
import { PinLoginForm } from "./pin-login-form";
import { AuthCompact } from "@/components/ui/AuthShell";

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
      <div className="flex flex-1 flex-col">
        <h2 className="mb-4 text-2xl font-semibold text-[var(--color-text)]">{t("whoAreYou")}</h2>
        <div className="space-y-3">
          <RoleCard
            icon={Heart}
            tone="highlight"
            label={t("roleCaregiver")}
            hint={t("roleCaregiverHint")}
            onSelect={() => writeLoginRole("caregiver")}
          />
          <RoleCard
            icon={House}
            tone="accent"
            label={t("roleOwner")}
            hint={t("roleOwnerHint")}
            onSelect={() => writeLoginRole("owner")}
          />
        </div>
        {/* Only families sign up; caregivers join through an invite. */}
        <p className="mt-auto pt-8 text-center text-base text-[var(--color-text-muted)]">
          {t("noAccount")}{" "}
          <Link
            href={`/${locale}/register`}
            className="font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            {t("createAccount")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <AuthCompact />
      <div className="flex items-center justify-between gap-3">
        {/* Which door you came in by: a kunyit chip, with the way back. */}
        <p
          className={`inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5 text-base font-semibold ${
            role === "caregiver"
              ? "bg-[var(--color-highlight-soft)] text-[var(--color-highlight-ink)]"
              : "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
          }`}
        >
          {role === "caregiver" ? (
            <Heart size={18} weight="fill" aria-hidden="true" />
          ) : (
            <House size={18} weight="fill" aria-hidden="true" />
          )}
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
          <p className="mt-auto text-center text-base text-[var(--color-text-muted)]">
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
  /** Caregiver = kunyit, owner = teal: the two doors read differently. */
  tone: "highlight" | "accent";
  label: string;
  hint: string;
  onSelect: () => void;
}

/** One of the two role cards: ≥ 96px tall, icon + label (spec §7). */
function RoleCard({ icon: IconComponent, tone, label, hint, onSelect }: RoleCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-24 w-full items-center gap-4 rounded-xl border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-4 text-left transition-[transform,colors] duration-[120ms] hover:border-[var(--color-accent)] active:scale-[0.98]"
    >
      <span
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${
          tone === "highlight"
            ? "bg-[var(--color-highlight-soft)] text-[var(--color-highlight-ink)]"
            : "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
        }`}
      >
        <IconComponent size={28} weight="fill" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold text-[var(--color-text)]">{label}</span>
        <span className="mt-0.5 block text-base text-[var(--color-text-muted)]">{hint}</span>
      </span>
      <CaretRight size={22} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
    </button>
  );
}
