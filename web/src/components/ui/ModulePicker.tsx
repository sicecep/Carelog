"use client";

import { useTranslations } from "next-intl";
import { MODULES, type Module } from "@/lib/constants.generated";

interface ModulePickerProps {
  value: Module[];
  onChange: (next: Module[]) => void;
  /** Accessible name of the group. */
  label: string;
}

/**
 * Checkbox grid of every module. Any module may be enabled for any care
 * type; the enabled set decides which categories a caregiver can log.
 * Shared by onboarding and the edit sheet.
 */
export function ModulePicker({ value, onChange, label }: ModulePickerProps) {
  const t = useTranslations("onboarding.modules");

  const toggle = (module: Module) => {
    const next = value.includes(module) ? value.filter((m) => m !== module) : [...value, module];
    // Keep the canonical order so saved lists compare and display stably.
    onChange(MODULES.filter((m) => next.includes(m)));
  };

  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
      {MODULES.map((module) => (
        <label
          key={module}
          className="touch-target flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <input
            type="checkbox"
            checked={value.includes(module)}
            onChange={() => toggle(module)}
            className="h-5 w-5 shrink-0 rounded border-[var(--color-border-control)] text-[var(--color-accent)]"
          />
          <span className="text-base text-[var(--color-text)]">{t(module)}</span>
        </label>
      ))}
    </div>
  );
}
