"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, DeviceMobile, Sun } from "phosphor-react";
import { applyAppearance, type Appearance } from "@/lib/appearance";

/**
 * Akun → Tampilan: follow the phone's light/dark setting (default) or always
 * stay light. Per device (a cookie), applied at once without a reload.
 *
 * Native radio inputs stretched over big cards: keyboard and screen readers
 * get a real radio group, and each option is a ≥ 56px target. Selection shows by
 * fill + border + check icon together (DESIGN.md §8.3).
 */
export function AppearanceSetting({ initial }: { initial: Appearance }) {
  const t = useTranslations("account");
  const [value, setValue] = useState<Appearance>(initial);

  const options: { id: Appearance; label: string; hint: string; Icon: typeof Sun }[] = [
    { id: "system", label: t("appearanceSystem"), hint: t("appearanceSystemHint"), Icon: DeviceMobile },
    { id: "light", label: t("appearanceLight"), hint: t("appearanceLightHint"), Icon: Sun },
  ];

  return (
    <section className="card mt-6" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="text-lg font-semibold text-[var(--color-text)]">
        {t("appearanceHeading")}
      </h2>
      <div role="radiogroup" aria-labelledby="appearance-heading" className="mt-4 space-y-3">
        {options.map(({ id, label, hint, Icon }) => {
          const on = value === id;
          return (
            <label
              key={id}
              data-testid={`appearance-${id}`}
              className={`relative flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border-2 px-4 py-3 transition-colors has-[:focus-visible]:shadow-[var(--shadow-focus)] ${
                on
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-[var(--color-border-control)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]"
              }`}
            >
              <input
                type="radio"
                name="appearance"
                value={id}
                checked={on}
                onChange={() => {
                  setValue(id);
                  applyAppearance(id);
                }}
                // Invisible but the size of the whole card, so the real
                // radio is the 64px target (not a 1px sr-only box); the
                // focus ring is drawn on the card via has-[:focus-visible].
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-lg opacity-0"
              />
              <Icon
                size={26}
                weight={on ? "fill" : "regular"}
                aria-hidden="true"
                className={on ? "shrink-0 text-[var(--color-accent-ink)]" : "shrink-0 text-[var(--color-text-muted)]"}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-base font-semibold ${
                    on ? "text-[var(--color-accent-ink)]" : "text-[var(--color-text)]"
                  }`}
                >
                  {label}
                </span>
                <span className="block text-sm text-[var(--color-text-muted)]">{hint}</span>
              </span>
              {on && (
                <CheckCircle size={24} weight="fill" aria-hidden="true" className="shrink-0 text-[var(--color-accent)]" />
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
