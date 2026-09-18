"use client";

// Action layer for the recipient detail page: two fixed action buttons (log
// activity + report incident) driving the existing bottom sheets. Client
// component because sheets are open/close state + the router refresh callback.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, WarningOctagon } from "phosphor-react";
import { LoggingSheet } from "@/components/ui/LoggingSheet";
import { IncidentSheet } from "@/components/ui/IncidentSheet";
import { EditRecipientSheet } from "@/components/ui/EditRecipientSheet";
import { Recipient, shiftApi } from "@/lib/api-client";

interface DetailActionsProps {
  recipientId: string;
  workspaceId: string;
  recipient: Recipient;
  /**
   * SFT-001 #4: caregivers are soft-blocked from logging before checking
   * in. Undefined for owners, who never check in and must never see this.
   */
  shiftPrompt?: {
    caregiverId: string;
    /** True when the caregiver has no open shift. */
    offShift: boolean;
  };
}

export function DetailActions({
  recipientId,
  workspaceId,
  recipient,
  shiftPrompt,
}: DetailActionsProps) {
  const t = useTranslations("logging");
  const tIncidents = useTranslations("incidents");
  const tShifts = useTranslations("shifts");
  const router = useRouter();

  const [loggingOpen, setLoggingOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shiftNudge, setShiftNudge] = useState(false);
  const [startingShift, setStartingShift] = useState(false);

  // Server Component page owns the timeline data; refresh re-runs its fetches
  // so a new entry/incident appears without a manual reload.
  const handleLogged = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleUpdated = useCallback(() => {
    router.refresh();
  }, [router]);

  // SFT-001 #4: a SOFT block. An off-shift caregiver tapping "log" gets a
  // nudge, not a wall — they can start the shift or log anyway in one tap.
  // Care that already happened must always be recordable; refusing the log
  // would just push it back into WhatsApp, which is the problem CareLog
  // exists to solve.
  const openLogging = useCallback(() => {
    if (shiftPrompt?.offShift) {
      setShiftNudge(true);
      return;
    }
    setLoggingOpen(true);
  }, [shiftPrompt]);

  const startShiftThenLog = useCallback(async () => {
    if (!shiftPrompt) return;
    setStartingShift(true);
    try {
      await shiftApi.checkIn(workspaceId, shiftPrompt.caregiverId);
      router.refresh();
    } catch (err) {
      // Starting the shift is a convenience here; if it fails, still let
      // them log. Losing the entry would be the worse outcome.
      console.error("check-in from logging nudge failed", err);
    } finally {
      setStartingShift(false);
      setShiftNudge(false);
      setLoggingOpen(true);
    }
  }, [shiftPrompt, workspaceId, router]);

  return (
    <>
      {/* Fixed action bar. 56px+ targets, text + icon (never icon-only) per
          the "Bu Sari" accessibility bar. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-5xl gap-3">
          <button
            type="button"
            onClick={openLogging}
            data-testid="open-logging"
            className="btn-base btn-primary touch-target flex-[2] text-base"
          >
            <Plus size={22} weight="bold" />
            <span className="ml-1">{t("open")}</span>
          </button>
          <button
            type="button"
            onClick={() => setIncidentOpen(true)}
            data-testid="open-incident"
            className="btn-base btn-danger touch-target flex-[1] text-base"
          >
            <WarningOctagon size={22} weight="bold" />
            <span className="ml-1">{tIncidents("report")}</span>
          </button>
        </div>
      </div>

      {/* Soft-block nudge. Deliberately NOT applied to incident reporting:
          an emergency cannot wait for a check-in. */}
      {shiftNudge && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-nudge-title"
          data-testid="shift-nudge"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
        >
          <div className="w-full max-w-md rounded-xl bg-[var(--color-surface)] p-5 shadow-xl">
            <h2
              id="shift-nudge-title"
              className="text-lg font-semibold text-[var(--color-text)]"
            >
              {tShifts("nudgeTitle")}
            </h2>
            <p className="mt-2 text-base text-[var(--color-text-muted)]">
              {tShifts("nudgeBody")}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                data-testid="shift-nudge-start"
                onClick={startShiftThenLog}
                disabled={startingShift}
                className="btn-base btn-primary touch-target w-full text-base disabled:opacity-60"
              >
                {startingShift ? tShifts("checkingIn") : tShifts("nudgeStart")}
              </button>
              <button
                type="button"
                data-testid="shift-nudge-skip"
                onClick={() => {
                  setShiftNudge(false);
                  setLoggingOpen(true);
                }}
                className="touch-target inline-flex w-full items-center justify-center rounded-lg border-2 border-[var(--color-border-strong)] text-base font-medium text-[var(--color-text)] hover:border-[var(--color-accent)]"
              >
                {tShifts("nudgeSkip")}
              </button>
            </div>
          </div>
        </div>
      )}

      <LoggingSheet
        open={loggingOpen}
        onClose={() => setLoggingOpen(false)}
        recipientId={recipientId}
        workspaceId={workspaceId}
        onLogged={handleLogged}
      />
      <IncidentSheet
        open={incidentOpen}
        onClose={() => setIncidentOpen(false)}
        recipientId={recipientId}
        workspaceId={workspaceId}
        onLogged={handleLogged}
      />
      <EditRecipientSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        recipient={recipient}
        workspaceId={workspaceId}
        onUpdated={handleUpdated}
      />
    </>
  );
}
