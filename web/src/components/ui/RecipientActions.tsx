import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Trash, ArchiveBox, ArrowClockwise } from "phosphor-react";
import { recipientApi, type Recipient } from "@/lib/api-client";

interface RecipientActionsProps {
  recipientId: string;
  workspaceId: string;
  isActive: boolean;
  onRefresh: () => void;
}

export function RecipientActions({ recipientId, workspaceId, isActive, onRefresh }: RecipientActionsProps) {
  const t = useTranslations("recipients");
  const [busy, setBusy] = useState(false);

  const handleArchive = useCallback(async () => {
    if (!window.confirm(t("confirmArchive"))) return;
    setBusy(true);
    try {
      await recipientApi.archive(workspaceId, recipientId);
      onRefresh();
    } catch (e) {
      alert(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }, [workspaceId, recipientId, onRefresh, t]);

  const handleReactivate = useCallback(async () => {
    setBusy(true);
    try {
      await recipientApi.reactivate(workspaceId, recipientId);
      onRefresh();
    } catch (e) {
      alert(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }, [workspaceId, recipientId, onRefresh, t]);

  return (
    <div className="flex gap-2">
      {isActive ? (
        <button
          onClick={handleArchive}
          disabled={busy}
          className="btn-base btn-ghost btn-icon touch-target text-[var(--color-error-ink)]"
          title={t("archive")}
        >
          <ArchiveBox size={20} />
        </button>
      ) : (
        <button
          onClick={handleReactivate}
          disabled={busy}
          className="btn-base btn-ghost btn-icon touch-target text-[var(--color-accent-ink)]"
          title={t("reactivate")}
        >
          <ArrowClockwise size={20} />
        </button>
      )}
    </div>
  );
}
