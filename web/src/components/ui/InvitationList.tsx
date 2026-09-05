"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, UserPlus } from "phosphor-react";
import { cn } from "@/lib/utils";
import { Invitation, invitationApi, APIError } from "@/lib/api-client";

interface InvitationListProps {
  workspaceId: string;
}

export function InvitationList({ workspaceId }: InvitationListProps) {
  const t = useTranslations("invitecaregiver");
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invitationApi.list(workspaceId);
      if (res.data) setInvites(res.data);
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  const handleToggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next) void loadInvites();
  }, [open, loadInvites]);

  const handleRevoke = async (id: string) => {
    if (!window.confirm(t("confirmRevoke"))) return;
    try {
      await invitationApi.revoke(workspaceId, id);
      setInvites(invites.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    }
  };

  // Deterministic, locale-independent formatting.
  //
  // toLocaleString() resolves against the *runtime's* locale and timezone, which
  // differ between the Node server and the phone (server is UTC, the phone is
  // Asia/Jakarta). That produced two different strings for the same timestamp
  // and tripped React's hydration check. A fixed format renders identically in
  // both places, so there is nothing to mismatch.
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "btn-base btn-secondary touch-target inline-flex items-center gap-2",
          open && "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
        )}
      >
        <UserPlus size={20} weight="bold" aria-hidden="true" />
        <span>{t("manageInvitations")}</span>
      </button>

      {open && (
        <div className="mt-4 card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">{t("pendingInvitations")}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-base btn-ghost btn-icon touch-target"
            >
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {error && <p role="alert" className="mb-3 text-sm text-[var(--color-error-ink)]">{error}</p>}

          {loading ? (
            <p className="text-center text-[var(--color-text-muted)]">{t("loading")}</p>
          ) : invites.length === 0 ? (
            <p className="text-center text-[var(--color-text-muted)]">{t("noPending")}</p>
          ) : (
            <ul className="space-y-3" role="list">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-4 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border-strong)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[var(--color-text)] truncate">{inv.invitee_name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {t("role")}: {inv.role === "caregiver" ? t("caregiverRole") : t("viewerRole")} •{" "}
                      {t("expires")} {formatDate(inv.expires_at)}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {t("created")} {formatDate(inv.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(inv.id)}
                    className="btn-base btn-ghost touch-target px-3 py-2 text-sm text-[var(--color-error-ink)] hover:bg-[var(--color-error-soft)]"
                  >
                    {t("revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}