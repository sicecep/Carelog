"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatClock, formatShortDate } from "@/lib/format-time";
import { Invitation, invitationApi, APIError } from "@/lib/api-client";

interface InvitationListProps {
  workspaceId: string;
  /** Active invitations fetched by the server page. */
  initialInvites: Invitation[];
  /** Workspace IANA zone for the dates shown. */
  timezone: string;
}

export function InvitationList({ workspaceId, initialInvites, timezone }: InvitationListProps) {
  const t = useTranslations("invitecaregiver");
  const locale = useLocale();
  const [invites, setInvites] = useState<Invitation[]>(initialInvites);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = async (id: string) => {
    if (!window.confirm(t("confirmRevoke"))) return;
    try {
      await invitationApi.revoke(workspaceId, id);
      setInvites(invites.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    }
  };

  // Workspace zone + app locale, so the server render and the phone agree
  // (lib/format-time.ts explains the hydration trap).
  const formatDate = (iso: string) =>
    `${formatShortDate(iso, locale, timezone)} ${formatClock(iso, locale, timezone)}`;

  // Shown straight away (UI revamp phase 4); the section heading lives on
  // the page. It used to sit behind a "Kelola Undangan" button.
  return (
    <div>
          {error && <p role="alert" className="mb-3 text-sm text-[var(--color-error-ink)]">{error}</p>}

          {invites.length === 0 ? (
            <p className="card text-base text-[var(--color-text-muted)]">{t("noPending")}</p>
          ) : (
            <ul className="space-y-3" role="list">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold wrap-anywhere text-[var(--color-text)]">{inv.invitee_name}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {t("role")}: {inv.role === "caregiver" ? t("caregiverRole") : t("viewerRole")} •{" "}
                      {t("expires")} {formatDate(inv.expires_at)}
                    </p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {t("created")} {formatDate(inv.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(inv.id)}
                    className="btn-base btn-ghost touch-target shrink-0 px-3 text-base text-[var(--color-error-ink)] hover:bg-[var(--color-error-soft)]"
                  >
                    {t("revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}