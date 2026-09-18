"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { reminderApi, type ReminderPrefs } from "@/lib/api-client";

// NOT-001 (6): caregiver reminder controls — disable, or snooze for a day.
//
// Rendered only for caregivers (the server page gates it): owners never
// receive the reminder, so showing them the switch would be a control that
// does nothing. State is optimistic with a rollback on failure — a settings
// toggle that silently no-ops on a network blip trains people to distrust
// it.
export function ReminderSettings({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: ReminderPrefs;
}) {
  const t = useTranslations("reminderSettings");
  const [prefs, setPrefs] = useState<ReminderPrefs>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (disabled: boolean, snoozeDays: number) => {
      const prev = prefs;
      setSaving(true);
      setError(null);
      // Optimistic: reflect the intended state immediately.
      setPrefs({
        disabled,
        snoozed_until:
          snoozeDays > 0
            ? new Date(Date.now() + (snoozeDays - 1) * 86400000)
                .toISOString()
                .slice(0, 10)
            : null,
      });
      try {
        const res = await reminderApi.update(workspaceId, disabled, snoozeDays);
        if (res.data) setPrefs(res.data);
      } catch (err) {
        console.error("reminder prefs update failed", err);
        setPrefs(prev); // roll back
        setError(t("saveError"));
      } finally {
        setSaving(false);
      }
    },
    [prefs, workspaceId, t],
  );

  const snoozeActive =
    prefs.snoozed_until != null &&
    prefs.snoozed_until >= new Date().toISOString().slice(0, 10);

  return (
    <section
      data-testid="reminder-settings"
      className="card mt-6 p-6"
      aria-labelledby="reminder-settings-title"
    >
      <h2
        id="reminder-settings-title"
        className="text-lg font-medium text-[var(--color-text)]"
      >
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t("body")}</p>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-medium text-[var(--color-text)]">
            {t("enabledLabel")}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {prefs.disabled ? t("stateOff") : t("stateOn")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!prefs.disabled}
          data-testid="reminder-toggle"
          disabled={saving}
          onClick={() => save(!prefs.disabled, 0)}
          className={`touch-target relative inline-flex w-16 shrink-0 items-center rounded-full px-1 transition-colors disabled:opacity-60 ${
            prefs.disabled
              ? "bg-[var(--color-border-strong)]"
              : "bg-[var(--color-accent)]"
          }`}
        >
          <span
            className={`inline-block h-6 w-6 rounded-full bg-white transition-transform ${
              prefs.disabled ? "translate-x-0" : "translate-x-8"
            }`}
          />
        </button>
      </div>

      {/* Snooze is only meaningful while reminders are on. */}
      {!prefs.disabled && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          {snoozeActive ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-[var(--color-text)]">
                {t("snoozedUntil", { date: prefs.snoozed_until ?? "" })}
              </p>
              <button
                type="button"
                data-testid="reminder-unsnooze"
                disabled={saving}
                onClick={() => save(false, 0)}
                className="touch-target inline-flex items-center rounded-lg border-2 border-[var(--color-border-strong)] px-4 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] disabled:opacity-60"
              >
                {t("unsnooze")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="reminder-snooze"
              disabled={saving}
              onClick={() => save(false, 1)}
              className="touch-target inline-flex items-center rounded-lg border-2 border-[var(--color-border-strong)] px-4 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] disabled:opacity-60"
            >
              {t("snoozeTomorrow")}
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="reminder-error"
          className="mt-3 text-sm font-medium text-[var(--color-error-ink)]"
        >
          {error}
        </p>
      )}
    </section>
  );
}
