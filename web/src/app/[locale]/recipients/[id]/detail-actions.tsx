"use client";

// Action layer for the recipient detail page: two fixed action buttons (log
// activity + report incident). The sheets and the shift nudge live in LogFlow,
// shared with the home screen's quick-log tiles.

import { useTranslations } from "next-intl";
import { Plus, WarningOctagon } from "phosphor-react";
import type { Module } from "@/lib/constants.generated";
import { LogFlow } from "@/components/ui/LogFlow";

interface DetailActionsProps {
  recipientId: string;
  workspaceId: string;
  /** The recipient's enabled modules: what the logging sheet offers. */
  modules: Module[];
  /** SFT-001 #4 soft-block; undefined for owners. See LogFlow. */
  shiftPrompt?: {
    caregiverId: string;
    offShift: boolean;
  };
}

export function DetailActions({ recipientId, workspaceId, modules, shiftPrompt }: DetailActionsProps) {
  const t = useTranslations("logging");
  const tIncidents = useTranslations("incidents");

  return (
    <LogFlow
      recipientId={recipientId}
      workspaceId={workspaceId}
      modules={modules}
      shiftPrompt={shiftPrompt}
    >
      {/* Fixed action bar. 56px+ targets, text + icon (never icon-only) per
          the "Bu Sari" accessibility bar. */}
      {({ openLogging, openIncident }) => (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto flex max-w-5xl gap-3">
              <button
                type="button"
                onClick={() => openLogging()}
                data-testid="open-logging"
                className="btn-base btn-primary touch-target flex-[2] text-base"
              >
                <Plus size={22} weight="bold" />
                <span className="ml-1">{t("open")}</span>
              </button>
              <button
                type="button"
                onClick={openIncident}
                data-testid="open-incident"
                className="btn-base btn-danger touch-target flex-[1] text-base"
              >
                <WarningOctagon size={22} weight="bold" />
                <span className="ml-1">{tIncidents("report")}</span>
              </button>
            </div>
          </div>
      )}
    </LogFlow>
  );
}
