"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { GENDERS, RECIPIENT_MEASUREMENTS, type Gender } from "@/lib/constants.generated";
import {
  MIN_BIRTH_DATE,
  todayISO,
  type RecipientDetailsDraft,
  type RecipientDetailsErrors,
} from "@/lib/recipient-details";

interface RecipientDetailsFieldsProps {
  value: RecipientDetailsDraft;
  onChange: (next: RecipientDetailsDraft) => void;
  errors?: RecipientDetailsErrors;
  /** Prefix for input ids, so two forms on one page never share an id. */
  idPrefix: string;
}

/**
 * The optional part of a care recipient's profile: gender, date of birth,
 * current weight and height. Shared by onboarding and the edit sheet so both
 * validate and label the fields the same way. Every field may stay empty.
 */
export function RecipientDetailsFields({ value, onChange, errors = {}, idPrefix }: RecipientDetailsFieldsProps) {
  const t = useTranslations("recipientDetails");
  // Browser-only: "today" can differ between the server render and the
  // browser around midnight, and a mismatched attribute breaks hydration.
  const maxDate = useSyncExternalStore(noopSubscribe, todayISO, () => undefined);

  const set = <K extends keyof RecipientDetailsDraft>(key: K, v: RecipientDetailsDraft[K]) =>
    onChange({ ...value, [key]: v });

  const ids = {
    gender: `${idPrefix}-gender`,
    dob: `${idPrefix}-dob`,
    weight: `${idPrefix}-weight`,
    height: `${idPrefix}-height`,
  };

  const errorText = (key: keyof RecipientDetailsDraft, range?: { min: number; max: number; unit: string }) => {
    const code = errors[key];
    if (!code) return undefined;
    return code === "outOfRange" && range ? t("outOfRange", range) : t(code);
  };

  const dobError = errorText("dateOfBirth");
  const weightError = errorText("weightKg", RECIPIENT_MEASUREMENTS.weight_kg);
  const heightError = errorText("heightCm", RECIPIENT_MEASUREMENTS.height_cm);

  return (
    <fieldset className="space-y-4">
      <legend className="text-base font-semibold text-[var(--color-text)]">
        {t("heading")}{" "}
        <span className="text-sm font-normal text-[var(--color-text-muted)]">({t("optional")})</span>
      </legend>
      <p className="text-sm text-[var(--color-text-muted)]">{t("hint")}</p>

      <div>
        <p id={ids.gender} className="mb-1 text-base font-medium text-[var(--color-text)]">
          {t("gender")}
        </p>
        <div role="radiogroup" aria-labelledby={ids.gender} className="flex flex-wrap gap-2">
          {GENDERS.map((g: Gender) => {
            const selected = value.gender === g;
            return (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={selected}
                // Tapping the chosen option again clears it: the field is optional.
                onClick={() => set("gender", selected ? "" : g)}
                className={cn(
                  "touch-target flex-auto rounded-[var(--radius-md)] border-2 px-4 text-base font-medium transition-colors",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                    : "border-[var(--color-border-control)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                )}
              >
                {t(`genders.${g}`)}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t("genderClearHint")}</p>
      </div>

      <div>
        <label htmlFor={ids.dob} className="mb-1 block text-base font-medium text-[var(--color-text)]">
          {t("dateOfBirth")}
        </label>
        <input
          id={ids.dob}
          type="date"
          min={MIN_BIRTH_DATE}
          max={maxDate}
          value={value.dateOfBirth}
          onChange={(e) => set("dateOfBirth", e.target.value)}
          aria-invalid={!!dobError}
          aria-describedby={dobError ? `${ids.dob}-error` : undefined}
          className="input-base w-full"
        />
        {dobError && (
          <p id={`${ids.dob}-error`} role="alert" className="mt-1 text-sm text-[var(--color-error-ink)]">
            {dobError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MeasurementInput
          id={ids.weight}
          label={t("weight")}
          unit={RECIPIENT_MEASUREMENTS.weight_kg.unit}
          value={value.weightKg}
          onChange={(v) => set("weightKg", v)}
          error={weightError}
        />
        <MeasurementInput
          id={ids.height}
          label={t("height")}
          unit={RECIPIENT_MEASUREMENTS.height_cm.unit}
          value={value.heightCm}
          onChange={(v) => set("heightCm", v)}
          error={heightError}
        />
      </div>
    </fieldset>
  );
}

const noopSubscribe = () => () => {};

function MeasurementInput({
  id,
  label,
  unit,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-base font-medium text-[var(--color-text)]">
        {label}
      </label>
      <div className="relative">
        {/* Text with a decimal keypad rather than type="number": it accepts
            the comma decimal separator Indonesian keyboards produce. */}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className="input-base w-full pr-12"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-base text-[var(--color-text-muted)]"
        >
          {unit}
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-[var(--color-error-ink)]">
          {error}
        </p>
      )}
    </div>
  );
}
