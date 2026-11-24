"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "phosphor-react";
import { cn } from "@/lib/utils";
import { AdminUser, adminApi, APIError } from "@/lib/api-client";

interface AdminUserListProps {
  initialUsers: AdminUser[];
}

type Tab = AdminUser["approval_status"];

const TABS: Tab[] = ["pending", "approved", "rejected"];

export function AdminUserList({ initialUsers }: AdminUserListProps) {
  const t = useTranslations("admin");
  const [tab, setTab] = useState<Tab>("pending");
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the row mid-request shows a pending state.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Login revamp D2: the temporary password from an admin reset. Shown
  // once, kept only in memory, and cleared when dismissed.
  const [tempPassword, setTempPassword] = useState<{ name: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (status: Tab) => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.listUsers(status);
        setUsers(res.data ?? []);
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    void load(next);
  };

  const handleApprove = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await adminApi.approve(userId);
      // Drop the row: it no longer belongs in the list being viewed.
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (userId: string) => {
    if (!window.confirm(t("confirmReject"))) return;
    // Reason is optional — an empty prompt is a valid rejection.
    const reason = window.prompt(t("reasonPrompt")) ?? undefined;

    setBusyId(userId);
    setError(null);
    try {
      await adminApi.reject(userId, reason || undefined);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setBusyId(null);
    }
  };

  const displayName = (u: AdminUser) => u.full_name?.trim() || u.email || u.phone || u.id;

  const handleResetPassword = async (u: AdminUser) => {
    if (!window.confirm(t("confirmReset", { name: displayName(u) }))) return;
    setBusyId(u.id);
    setError(null);
    try {
      const res = await adminApi.resetPassword(u.id);
      if (res.data?.temporary_password) {
        setCopied(false);
        setTempPassword({ name: displayName(u), value: res.data.temporary_password });
      }
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setBusyId(null);
    }
  };

  const copyTempPassword = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword.value);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (non-HTTPS, permissions); the value is on
      // screen to copy by hand.
    }
  };

  // Deterministic formatting: toLocaleString resolves against the runtime's
  // locale/timezone, which differs between the Node server (UTC) and the
  // browser, tripping React's hydration check. Same reasoning as
  // InvitationList and CareTeamList.
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  const tabLabel = (s: Tab) =>
    s === "pending" ? t("tabPending") : s === "approved" ? t("tabApproved") : t("tabRejected");

  return (
    <div>
      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => switchTab(s)}
            className={cn(
              "btn-base touch-target px-4",
              tab === s ? "btn-primary" : "btn-secondary"
            )}
          >
            {tabLabel(s)}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-[var(--color-error-ink)]">
          {error}
        </p>
      )}

      {tempPassword && (
        <div
          role="status"
          className="mb-4 space-y-3 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-4 text-[var(--color-warning-ink)]"
        >
          <p className="font-semibold">{t("tempPasswordTitle", { name: tempPassword.name })}</p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="select-all rounded-md bg-[var(--color-surface)] px-3 py-2 font-mono text-lg tracking-wider text-[var(--color-text)]">
              {tempPassword.value}
            </code>
            <button type="button" onClick={copyTempPassword} className="btn-base btn-secondary touch-target px-4">
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              {copied ? t("copied") : t("copy")}
            </button>
          </div>
          <p className="text-sm">{t("tempPasswordHelp")}</p>
          <button
            type="button"
            onClick={() => setTempPassword(null)}
            className="btn-base btn-primary touch-target px-4"
          >
            {t("done")}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-center text-[var(--color-text-muted)]">{t("loading")}</p>
      ) : users.length === 0 ? (
        <p className="card p-6 text-center text-[var(--color-text-muted)]">
          {tab === "pending" ? t("emptyPending") : t("empty")}
        </p>
      ) : (
        <ul className="space-y-3" role="list">
          {users.map((u) => {
            const busy = busyId === u.id;
            return (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4"
              >
                {/* Full width on a phone, so the name and email show whole
                    and the buttons wrap below: an admin must see who they are
                    approving. Side by side from sm up. */}
                <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <p className="font-semibold wrap-anywhere text-[var(--color-text)]">
                    {displayName(u)}
                    {u.is_super_admin && (
                      <span className="ml-2 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-xs font-normal text-[var(--color-accent-ink)]">
                        {t("superAdminBadge")}
                      </span>
                    )}
                  </p>
                  <p className="text-sm wrap-anywhere text-[var(--color-text-muted)]">
                    {[u.email, u.phone].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {t("signedUp")} {formatDate(u.created_at)}
                  </p>
                  {u.rejection_reason && (
                    <p className="mt-1 text-xs text-[var(--color-error-ink)]">
                      {t("reasonLabel")}: {u.rejection_reason}
                    </p>
                  )}
                </div>

                <div className="flex w-full items-center gap-2 sm:w-auto">
                  {u.approval_status !== "approved" && (
                    <button
                      type="button"
                      onClick={() => handleApprove(u.id)}
                      disabled={busy}
                      className="btn-base btn-primary touch-target px-4 disabled:opacity-50"
                    >
                      {busy ? t("approving") : t("approve")}
                    </button>
                  )}
                  {u.approval_status === "approved" && !u.is_super_admin && (
                    <button
                      type="button"
                      onClick={() => handleResetPassword(u)}
                      disabled={busy}
                      className="btn-base btn-secondary touch-target px-4 disabled:opacity-50"
                    >
                      {busy ? t("resetting") : t("resetPassword")}
                    </button>
                  )}
                  {u.approval_status !== "rejected" && (
                    <button
                      type="button"
                      onClick={() => handleReject(u.id)}
                      disabled={busy}
                      className="btn-base btn-ghost touch-target px-4 text-[var(--color-error-ink)] hover:bg-[var(--color-error-soft)] disabled:opacity-50"
                    >
                      {busy ? t("rejecting") : t("reject")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
