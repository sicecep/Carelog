"use client";

// The log + incident flow behind every "Catat" button: the logging sheet, the
// incident sheet, and the SFT-001 #4 "start your shift first?" nudge. Shared
// by the recipient page's action bar and the home screen's quick-log tiles,
// which render their own buttons through `children`.

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LoggingSheet } from "@/components/ui/LoggingSheet";
import { IncidentSheet } from "@/components/ui/IncidentSheet";
import type { LogCategory, Module } from "@/lib/constants.generated";
import { shiftApi } from "@/lib/api-client";

export interface LogFlowControls {
  /** Open the logging sheet, optionally straight on one category. */
  openLogging: (category?: LogCategory) => void;
  openIncident: () => void;
}

interface LogFlowProps {
  recipientId: string;
  workspaceId: string;
  /** The recipient's enabled modules: what the logging sheet offers. */
  modules: readonly Module[];
  /**
   * SFT-001 #4: caregivers are soft-blocked from logging before checking
   * in. Undefined for owners, who never check in and must never see this.
   */
  shiftPrompt?: {
    caregiverId: string;
    /** True when the caregiver has no open shift. */
    offShift: boolean;
  };
  children: (controls: LogFlowControls) => ReactNode;
}

export function LogFlow({ recipientId, workspaceId, modules, shiftPrompt, children }: LogFlowProps) {
  const tShifts = useTranslations("shifts");
  const router = useRouter();

  const [loggingOpen, setLoggingOpen] = useState(false);
  // A fresh key per opening remounts the sheet, so `initialCategory` (read
  // once on mount) applies to this opening only.
  const [sheetKey, setSheetKey] = useState(0);
  const [category, setCategory] = useState<LogCategory | undefined>(undefined);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [shiftNudge, setShiftNudge] = useState(false);
  const [startingShift, setStartingShift] = useState(false);

  // The Server Component page owns the data; refresh re-runs its fetches so
  // a new entry/incident appears without a manual reload.
  const handleLogged = useCallback(() => {
    router.refresh();
  }, [router]);

  const showSheet = useCallback(() => {
    setSheetKey((k) => k + 1);
    setLoggingOpen(true);
  }, []);

  // SFT-001 #4: a SOFT block. An off-shift caregiver tapping "log" gets a
  // nudge, not a wall — they can start the shift or log anyway in one tap.
  // Care that already happened must always be recordable; refusing the log
  // would just push it back into WhatsApp, which is the problem CareLog
  // exists to solve.
  const openLogging = useCallback(
    (cat?: LogCategory) => {
      setCategory(cat);
      if (shiftPrompt?.offShift) {
        setShiftNudge(true);
        return;
      }
      showSheet();
    },
    [shiftPrompt, showSheet]
  );

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
      showSheet();
    }
  }, [shiftPrompt, workspaceId, router, showSheet]);

  return (
    <>
      {children({ openLogging, openIncident: () => setIncidentOpen(true) })}

      {/* Soft-block nudge. Deliberately NOT applied to incident reporting:
          an emergency cannot wait for a check-in. */}
      {shiftNudge && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-nudge-title"
          data-testid="shift-nudge"
          className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--color-overlay)] p-4 sm:items-center"
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
                  showSheet();
                }}
                className="touch-target inline-flex w-full items-center justify-center rounded-md border-2 border-[var(--color-border-control)] text-base font-medium text-[var(--color-text)] hover:border-[var(--color-accent)]"
              >
                {tShifts("nudgeSkip")}
              </button>
            </div>
          </div>
        </div>
      )}

      <LoggingSheet
        key={sheetKey}
        open={loggingOpen}
        onClose={() => setLoggingOpen(false)}
        recipientId={recipientId}
        workspaceId={workspaceId}
        modules={modules}
        onLogged={handleLogged}
        initialCategory={category}
      />
      <IncidentSheet
        open={incidentOpen}
        onClose={() => setIncidentOpen(false)}
        recipientId={recipientId}
        workspaceId={workspaceId}
        onLogged={handleLogged}
      />
    </>
  );
}
