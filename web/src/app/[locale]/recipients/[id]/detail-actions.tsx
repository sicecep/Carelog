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
import { Recipient } from "@/lib/api-client";

interface DetailActionsProps {
  recipientId: string;
  workspaceId: string;
  recipient: Recipient;
}

export function DetailActions({ recipientId, workspaceId, recipient }: DetailActionsProps) {
  const t = useTranslations("logging");
  const tIncidents = useTranslations("incidents");
  const router = useRouter();

  const [loggingOpen, setLoggingOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Server Component page owns the timeline data; refresh re-runs its fetches
  // so a new entry/incident appears without a manual reload.
  const handleLogged = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleUpdated = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <>
      {/* Fixed action bar. 56px+ targets, text + icon (never icon-only) per
          the "Bu Sari" accessibility bar. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-5xl gap-3">
          <button
            type="button"
            onClick={() => setLoggingOpen(true)}
            className="btn-base btn-primary touch-target min-h-[56px] flex-[2] text-base"
          >
            <Plus size={22} weight="bold" />
            <span className="ml-1">{t("logActivity")}</span>
          </button>
          <button
            type="button"
            onClick={() => setIncidentOpen(true)}
            className="btn-base btn-danger touch-target min-h-[56px] flex-[1] text-base"
          >
            <WarningOctagon size={22} weight="bold" />
            <span className="ml-1">{tIncidents("report")}</span>
          </button>
        </div>
      </div>

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
