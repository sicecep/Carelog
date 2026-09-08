"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, UsersThree } from "phosphor-react";
import { cn } from "@/lib/utils";
import { Member, memberApi, APIError } from "@/lib/api-client";

interface CareTeamListProps {
  workspaceId: string;
  // The signed-in user's own id. Needed to render the "You" badge and to hide
  // the destructive controls on their own row — the API rejects self-edits, so
  // showing those buttons would only produce a guaranteed error.
  currentUserId: string;
  // Only owners get role/remove controls. Non-owners still see the roster,
  // because knowing who is on the care team is not privileged information.
  canManage: boolean;
}

const ROLES: Member["role"][] = ["owner", "caregiver", "viewer"];

export function CareTeamList({ workspaceId, currentUserId, canManage }: CareTeamListProps) {
  const t = useTranslations("careteam");
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the row currently mid-request so only that row shows a pending state.
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await memberApi.list(workspaceId);
      if (res.data) setMembers(res.data);
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  const handleToggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next) void loadMembers();
  }, [open, loadMembers]);

  const roleLabel = (role: Member["role"]) => {
    if (role === "owner") return t("roleOwner");
    if (role === "caregiver") return t("roleCaregiver");
    return t("roleViewer");
  };

  const handleRoleChange = async (userId: string, role: Member["role"]) => {
    setBusyId(userId);
    setError(null);
    try {
      await memberApi.updateRole(workspaceId, userId, role);
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
    } catch (err) {
      // Surfaces the API's own guard messages (last owner, self-demotion) —
      // they are already written for the end user.
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
      // Re-sync so the <select> doesn't keep an optimistic value the API rejected.
      void loadMembers();
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!window.confirm(t("confirmRemove"))) return;
    setBusyId(userId);
    setError(null);
    try {
      await memberApi.remove(workspaceId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setBusyId(null);
    }
  };

  // Deterministic, locale-independent formatting. toLocaleString() resolves
  // against the runtime's locale/timezone, which differs between the Node
  // server (UTC) and the phone (Asia/Jakarta) — that mismatch trips React's
  // hydration check. Same reasoning as InvitationList.
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        className={cn(
          "btn-base btn-secondary touch-target inline-flex items-center gap-2",
          open && "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
        )}
      >
        <UsersThree size={20} weight="bold" aria-hidden="true" />
        <span>{t("manage")}</span>
      </button>

      {open && (
        <div className="mt-4 card p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">{t("title")}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("close")}
              className="btn-base btn-ghost btn-icon touch-target"
            >
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {error && (
            <p role="alert" className="mb-3 text-sm text-[var(--color-error-ink)]">
              {error}
            </p>
          )}

          {loading ? (
            <p className="text-center text-[var(--color-text-muted)]">{t("loading")}</p>
          ) : members.length === 0 ? (
            <p className="text-center text-[var(--color-text-muted)]">{t("empty")}</p>
          ) : (
            <ul className="space-y-3" role="list">
              {members.map((m) => {
                const isSelf = m.user_id === currentUserId;
                const busy = busyId === m.user_id;
                // Self rows never get controls: the API rejects self-edits by
                // design, so rendering them would guarantee a failed request.
                const showControls = canManage && !isSelf;

                return (
                  <li
                    key={m.user_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[var(--color-text)]">
                        {m.full_name?.trim() || m.email}
                        {isSelf && (
                          <span className="ml-2 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-xs font-normal text-[var(--color-accent-ink)]">
                            {t("you")}
                          </span>
                        )}
                        {!m.is_active && (
                          <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                            ({t("inactive")})
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-[var(--color-text-muted)]">{m.email}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {roleLabel(m.role)} • {t("joined")} {formatDate(m.joined_at)}
                      </p>
                    </div>

                    {showControls && (
                      <div className="flex items-center gap-2">
                        <label className="sr-only" htmlFor={`role-${m.user_id}`}>
                          {t("changeRoleFor", { name: m.full_name?.trim() || m.email })}
                        </label>
                        <select
                          id={`role-${m.user_id}`}
                          value={m.role}
                          disabled={busy}
                          // The Family role is read-only; the hint tells an owner
                          // what they are actually granting before they grant it.
                          title={m.role === "viewer" ? t("roleViewerHint") : undefined}
                          onChange={(e) =>
                            handleRoleChange(m.user_id, e.target.value as Member["role"])
                          }
                          className="touch-target min-h-[56px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-text)]"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemove(m.user_id)}
                          disabled={busy}
                          className="btn-base btn-ghost touch-target min-h-[56px] px-3 text-sm text-[var(--color-error-ink)] hover:bg-[var(--color-error-soft)] disabled:opacity-50"
                        >
                          {busy ? t("removing") : t("remove")}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
