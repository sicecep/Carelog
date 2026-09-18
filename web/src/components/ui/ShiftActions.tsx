"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { shiftApi, type ShiftRow } from "@/lib/api-client";

/**
 * SFT-001 / SFT-002 — caregiver shift check-in and check-out on the home
 * screen.
 *
 * Design points, all from the PRD's acceptance criteria:
 *
 *   - Prominent "Start Shift" on the caregiver home. Rendered as an
 *     inline card, NOT a fixed bottom overlay, because there is already
 *     a fixed bottom nav on mobile — stacking two fixed bars leaves the
 *     caregiver with nowhere safe to tap.
 *   - "For caregivers only — owners are never prompted to check in." The
 *     parent chooses whether to render this component.
 *   - Check-out prompts for an optional handoff note that becomes visible
 *     to the incoming caregiver (SFT-003 already renders it).
 *   - Errors are surfaced in the UI, not swallowed to console.error. The
 *     original ungated version silently no-op'd on network failure.
 *   - A completed check-in refreshes the server component tree via
 *     router.refresh() so the parent's active-shift state and the shift
 *     cards on any recipient timeline pick up the change without a full
 *     page reload.
 */
export function ShiftActions({
  workspaceId,
  caregiverId,
  active,
}: {
  workspaceId: string;
  caregiverId: string;
  /** The caller's currently open shift, if any. undefined = not on shift. */
  active?: ShiftRow;
}) {
  const t = useTranslations("shifts");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffNote, setHandoffNote] = useState("");

  const checkIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await shiftApi.checkIn(workspaceId, caregiverId);
      router.refresh();
    } catch (err) {
      // The service enforces "one active shift per caregiver", so a stale
      // client rendering the "Start" button when a shift is already open
      // gets a real error here — surface it so the caregiver sees why.
      console.error("check-in failed", err);
      setError(t("checkInError"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, caregiverId, router, t]);

  const checkOut = useCallback(
    async (note: string) => {
      setLoading(true);
      setError(null);
      try {
        await shiftApi.checkOut(workspaceId, caregiverId, note.trim() || undefined);
        setHandoffOpen(false);
        setHandoffNote("");
        router.refresh();
      } catch (err) {
        console.error("check-out failed", err);
        setError(t("checkOutError"));
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, caregiverId, router, t],
  );

  // ── Currently on shift: show duration + End Shift ──────────────────────
  if (active) {
    return (
      <section
        aria-label={t("statusLabel")}
        data-testid="shift-actions"
        data-shift-status="active"
        className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-wide text-emerald-800">
              {t("onShiftLabel")}
            </p>
            <p className="mt-1 text-base text-emerald-900">
              {t("onShiftSince", { time: formatClock(active.checked_in_at) })}
            </p>
          </div>
          {!handoffOpen && (
            <button
              type="button"
              data-testid="end-shift-button"
              onClick={() => setHandoffOpen(true)}
              disabled={loading}
              className="touch-target inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 text-base font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
            >
              {t("endShift")}
            </button>
          )}
        </div>

        {handoffOpen && (
          <div className="mt-4 space-y-3" data-testid="handoff-prompt">
            <label
              htmlFor="handoff-note"
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              {t("handoffPromptLabel")}
              <span className="ml-1 text-[var(--color-text-muted)]">
                ({t("handoffPromptOptional")})
              </span>
            </label>
            <textarea
              id="handoff-note"
              data-testid="handoff-note-input"
              rows={3}
              value={handoffNote}
              onChange={(e) => setHandoffNote(e.target.value)}
              maxLength={500}
              placeholder={t("handoffPlaceholder")}
              className="input-base w-full resize-y py-3 text-base"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                data-testid="handoff-cancel"
                onClick={() => {
                  setHandoffOpen(false);
                  setHandoffNote("");
                }}
                disabled={loading}
                className="touch-target inline-flex items-center rounded-lg border-2 border-[var(--color-border-strong)] px-4 text-base font-medium text-[var(--color-text)] hover:border-[var(--color-accent)]"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                data-testid="handoff-confirm"
                onClick={() => checkOut(handoffNote)}
                disabled={loading}
                className="touch-target inline-flex items-center rounded-lg bg-red-600 px-4 text-base font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {loading ? t("checkingOut") : t("confirmEndShift")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            data-testid="shift-error"
            className="mt-3 text-sm font-medium text-red-700"
          >
            {error}
          </p>
        )}
      </section>
    );
  }

  // ── Not on shift: prominent Start Shift button ─────────────────────────
  return (
    <section
      aria-label={t("statusLabel")}
      data-testid="shift-actions"
      data-shift-status="inactive"
      className="rounded-lg border-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {t("offShiftLabel")}
          </p>
          <p className="mt-1 text-base text-[var(--color-text)]">
            {t("offShiftBody")}
          </p>
        </div>
        <button
          type="button"
          data-testid="start-shift-button"
          onClick={checkIn}
          disabled={loading}
          className="touch-target inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-6 text-base font-semibold text-white shadow-sm hover:brightness-110 disabled:opacity-60"
        >
          {loading ? t("checkingIn") : t("startShift")}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          data-testid="shift-error"
          className="mt-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}
    </section>
  );
}

/** HH:MM in the browser's timezone; the check-in was a wall-clock event. */
function formatClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}
