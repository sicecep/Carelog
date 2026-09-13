"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Users, UserPlus, X } from "phosphor-react";
import { assignmentApi, APIError, type AssignedCaregiver, type Member } from "@/lib/api-client";

interface AssignmentManagerProps {
  recipientId: string;
  workspaceId: string;
  canManage: boolean;
  /** Currently assigned caregivers (server-fetched, OWN-008D). */
  assigned: AssignedCaregiver[];
  /** Workspace members (server-fetched) — the assign picker draws from caregivers here. */
  members: Member[];
}

function displayName(c: AssignedCaregiver): string {
  return c.full_name?.trim() || c.email;
}

/**
 * Per-recipient care team (OWN-008A/B/C/D): lists who has access, and for the
 * owner lets them assign more caregivers or revoke one. Rendered on the
 * recipient detail page under the parent-notes panel.
 *
 * OWN-008B (one caregiver, several children) needs no separate control — the
 * owner simply assigns the same person on each child's page; the data model
 * is per-pair.
 */
export function AssignmentManager({
  recipientId,
  workspaceId,
  canManage,
  assigned,
  members,
}: AssignmentManagerProps) {
  const t = useTranslations("assignments");
  const [list, setList] = useState<AssignedCaregiver[]>(assigned);
  const [pickerId, setPickerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Candidates: workspace caregivers not already assigned to this recipient.
  const assignedIds = new Set(list.map((c) => c.user_id));
  const candidates = members.filter(
    (m) => m.role === "caregiver" && m.is_active && !assignedIds.has(m.user_id)
  );

  const refresh = async () => {
    const res = await assignmentApi.list(workspaceId, recipientId);
    setList(res.data ?? []);
  };

  const handleAssign = () => {
    if (!pickerId) return;
    setError(null);
    startTransition(async () => {
      try {
        await assignmentApi.assign(workspaceId, recipientId, pickerId);
        await refresh();
        setPickerId("");
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      }
    });
  };

  const handleRevoke = (userId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await assignmentApi.revoke(workspaceId, recipientId, userId);
        await refresh();
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      }
    });
  };

  return (
    <section aria-labelledby="assignments-heading" className="card">
      <h3
        id="assignments-heading"
        className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]"
      >
        <Users size={20} weight="fill" aria-hidden="true" />
        {t("title")}
      </h3>

      {list.length === 0 ? (
        <p className="mt-3 text-base text-[var(--color-text-muted)]">{t("empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {list.map((c) => (
            <li
              key={c.user_id}
              className="flex items-center justify-between gap-3 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-[var(--color-text)]">
                  {displayName(c)}
                </p>
                <p className="truncate text-sm text-[var(--color-text-muted)]">{c.email}</p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleRevoke(c.user_id)}
                  disabled={pending}
                  aria-label={t("revokeAria", { name: displayName(c) })}
                  className="btn-base btn-secondary btn-icon touch-target shrink-0"
                >
                  <X size={18} weight="bold" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-4">
          {candidates.length > 0 ? (
            <div className="flex gap-2">
              <label htmlFor="assign-picker" className="sr-only">
                {t("pickLabel")}
              </label>
              <select
                id="assign-picker"
                value={pickerId}
                onChange={(e) => setPickerId(e.target.value)}
                className="input-base w-full flex-1"
              >
                <option value="">{t("pickPlaceholder")}</option>
                {candidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name?.trim() || m.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAssign}
                disabled={pending || !pickerId}
                className="btn-base btn-primary touch-target shrink-0 px-4"
              >
                <UserPlus size={20} weight="bold" aria-hidden="true" />
                <span className="hidden sm:inline">{t("assign")}</span>
              </button>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">{t("noCandidates")}</p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-error-ink)]">
          {error}
        </p>
      )}
    </section>
  );
}
