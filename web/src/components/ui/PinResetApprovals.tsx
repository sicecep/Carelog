"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { pinResetApi, type PendingPINReset } from "@/lib/api-client";

/**
 * Owner-facing approval list for caregiver PIN resets (AUTH-005).
 *
 * The approval returns a single-use token bound to the device that asked.
 * The owner reads it out to the caregiver (who is usually standing next to
 * them, or on the phone) — it is deliberately NOT emailed or auto-applied,
 * because approving must not by itself grant access to whoever asked.
 *
 * Initial data arrives as a prop from the server component (CLAUDE.md: fetch
 * in server components, not useEffect). This component only re-fetches after
 * the owner acts, which is a genuine event-driven refresh rather than a
 * render-time side effect.
 */
export function PinResetApprovals({
  workspaceId,
  initialItems,
  initialError = false,
}: {
  workspaceId: string;
  initialItems: PendingPINReset[];
  initialError?: boolean;
}) {
  const t = useTranslations("pinResets");
  const [items, setItems] = useState<PendingPINReset[]>(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [granted, setGranted] = useState<{ id: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(
    initialError ? t("loadError") : null,
  );

  async function refresh() {
    try {
      const res = await pinResetApi.list(workspaceId);
      setItems(res.data ?? []);
    } catch {
      setError(t("loadError"));
    }
  }

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await pinResetApi.approve(workspaceId, id);
      if (res.data?.reset_token) {
        setGranted({ id, token: res.data.reset_token });
      }
      await refresh();
    } catch {
      setError(t("approveError"));
    } finally {
      setBusyId(null);
    }
  }

  async function deny(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await pinResetApi.deny(workspaceId, id);
      await refresh();
    } catch {
      setError(t("denyError"));
    } finally {
      setBusyId(null);
    }
  }

  // Nothing pending is the normal state — say so plainly rather than
  // rendering an empty box the owner has to interpret.
  if (items.length === 0 && !granted && !error) {
    return (
      <p data-testid="pin-resets-empty" className="text-base text-[var(--color-text-muted)]">
        {t("empty")}
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="pin-resets">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-soft)] px-4 py-3 text-base text-[var(--color-error-ink)]"
        >
          {error}
        </p>
      )}

      {granted && (
        <div
          role="status"
          data-testid="pin-reset-token"
          className="rounded-md border border-[var(--color-success)] bg-[var(--color-success-soft)] px-4 py-4"
        >
          <p className="text-base font-medium text-[var(--color-success-ink)]">{t("approvedTitle")}</p>
          <p className="mt-1 text-sm text-[var(--color-success-ink)]">{t("approvedBody")}</p>
          <p className="mt-3 select-all break-all rounded bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text)]">
            {granted.token}
          </p>
          <p className="mt-2 text-sm text-[var(--color-success-ink)]">{t("approvedExpiry")}</p>
        </div>
      )}

      {items.map((item) => (
        <div
          key={item.id}
          data-testid="pin-reset-request"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <p className="text-base font-medium text-[var(--color-text)]">{item.name}</p>
          <p className="text-sm text-[var(--color-text-muted)]">{item.phone}</p>
          {item.device_label && (
            // The device string is what makes this decision reviewable: an
            // unexpected device is the owner's cue to deny.
            <p className="mt-1 break-words text-sm text-[var(--color-text-muted)]">
              {t("device", { device: item.device_label })}
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => approve(item.id)}
              disabled={busyId === item.id}
              className="btn-base flex-1 bg-[var(--color-accent)] text-[var(--color-text-inverse)] disabled:opacity-50"
            >
              {t("approve")}
            </button>
            <button
              type="button"
              onClick={() => deny(item.id)}
              disabled={busyId === item.id}
              className="btn-base flex-1 border border-[var(--color-border-control)] bg-[var(--color-surface)] text-[var(--color-text)] disabled:opacity-50"
            >
              {t("deny")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
