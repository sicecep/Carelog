"use client";

import { useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatShortDate } from "@/lib/format-time";
import { LockSimple } from "phosphor-react";
import { toast } from "sonner";
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
  /** Members fetched by the server page, so the list renders straight away. */
  initialMembers: Member[];
  /** Workspace IANA zone for the "joined" dates. */
  timezone: string;
}

const ROLES: Member["role"][] = ["owner", "caregiver", "viewer"];

export function CareTeamList({
  workspaceId,
  currentUserId,
  canManage,
  initialMembers,
  timezone,
}: CareTeamListProps) {
  const t = useTranslations("careteam");
  const locale = useLocale();
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the row currently mid-request so only that row shows a pending state.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Inline username editor: the row being edited and its draft value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);

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

  const displayName = (m: Member) => m.full_name?.trim() || m.username || m.email;

  const startEditUsername = (m: Member) => {
    setEditingId(m.user_id);
    setUsernameDraft(m.username ?? "");
    setUsernameError(null);
  };

  const handleSaveUsername = async (userId: string) => {
    setBusyId(userId);
    setUsernameError(null);
    try {
      const res = await memberApi.updateUsername(workspaceId, userId, usernameDraft.trim());
      const saved = res.data?.username ?? usernameDraft.trim().toLowerCase();
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, username: saved } : m)));
      setEditingId(null);
      toast.success(t("usernameSaved"));
    } catch (err) {
      const code = err instanceof APIError ? err.code : "";
      setUsernameError(
        code === "username_taken"
          ? t("usernameTaken")
          : code === "username_invalid"
            ? t("usernameInvalid")
            : t("errorGeneric")
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleUnlock = async (m: Member) => {
    setBusyId(m.user_id);
    setError(null);
    try {
      await memberApi.unlockPIN(workspaceId, m.user_id);
      setMembers((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, pin_locked: false } : x)));
      toast.success(t("unlocked", { name: displayName(m) }));
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
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

  // Workspace zone + app locale, so the server render and the phone agree
  // (lib/format-time.ts explains the hydration trap).
  const formatDate = (iso: string) => formatShortDate(iso, locale, timezone);

  return (
    // Shown straight away (UI revamp phase 4): the roster used to sit behind a
    // "Kelola Tim Perawat" button and load only when opened.
    <div>
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
                    className="card flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
                        m.role === "owner"
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                          : "bg-[var(--color-highlight-soft)] text-[var(--color-highlight-ink)]"
                      }`}
                    >
                      {(displayName(m) ?? "?").trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold wrap-anywhere text-[var(--color-text)]">
                        {displayName(m)}
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
                      {/* The email is already the title when there is no
                          name; don't print it twice. */}
                      {m.email && m.email !== displayName(m) && (
                        <p className="text-sm wrap-anywhere text-[var(--color-text-muted)]">{m.email}</p>
                      )}
                      {m.username && (
                        <p className="text-sm wrap-anywhere text-[var(--color-text-muted)]">
                          {t("usernameLine", { username: m.username })}
                        </p>
                      )}
                      {m.pin_locked && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-ink)]">
                          <LockSimple size={14} weight="bold" aria-hidden="true" />
                          {t("locked")}
                        </p>
                      )}
                      <p className="text-sm text-[var(--color-text-muted)]">
                        {roleLabel(m.role)} • {t("joined")} {formatDate(m.joined_at)}
                      </p>
                    </div>

                    {showControls && (
                      <div className="flex w-full items-center gap-2">
                        <label className="sr-only" htmlFor={`role-${m.user_id}`}>
                          {t("changeRoleFor", { name: displayName(m) })}
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
                          className="touch-target flex-1 rounded-md border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-text)]"
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
                          className="btn-base btn-ghost touch-target px-3 text-base text-[var(--color-error-ink)] hover:bg-[var(--color-error-soft)] disabled:opacity-50"
                        >
                          {busy ? t("removing") : t("remove")}
                        </button>
                      </div>
                    )}

                    {/* Caregiver sign-in controls (login revamp §5.2, §6).
                        Owners sign in with email or phone, so their rows
                        get neither. */}
                    {showControls && m.role !== "owner" && (
                      <div className="flex w-full flex-wrap items-center gap-2">
                        {m.pin_locked && (
                          <button
                            type="button"
                            onClick={() => handleUnlock(m)}
                            disabled={busy}
                            className="btn-base btn-secondary touch-target px-3 text-sm disabled:opacity-50"
                          >
                            {busy ? t("unlocking") : t("unlock")}
                          </button>
                        )}
                        {editingId !== m.user_id && (
                          <button
                            type="button"
                            onClick={() => startEditUsername(m)}
                            disabled={busy}
                            className="btn-base btn-ghost touch-target px-3 text-sm text-[var(--color-accent)] disabled:opacity-50"
                          >
                            {m.username ? t("editUsername") : t("setUsername")}
                          </button>
                        )}
                      </div>
                    )}

                    {editingId === m.user_id && (
                      <form
                        className="w-full space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleSaveUsername(m.user_id);
                        }}
                      >
                        <label
                          htmlFor={`username-${m.user_id}`}
                          className="block text-sm font-semibold text-[var(--color-text)]"
                        >
                          {t("usernameFor", { name: displayName(m) })}
                        </label>
                        <input
                          id={`username-${m.user_id}`}
                          type="text"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          maxLength={30}
                          value={usernameDraft}
                          onChange={(e) => setUsernameDraft(e.target.value)}
                          className="input-base w-full"
                        />
                        {usernameError ? (
                          <p role="alert" className="text-sm text-[var(--color-error-ink)]">
                            {usernameError}
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--color-text-muted)]">{t("usernameHelp")}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={busy || usernameDraft.trim() === ""}
                            className="btn-base btn-primary touch-target px-4 text-sm disabled:opacity-50"
                          >
                            {busy ? t("saving") : t("save")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                            className="btn-base btn-ghost touch-target px-4 text-sm"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
    </div>
  );
}
