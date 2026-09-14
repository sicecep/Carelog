"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Bell } from "phosphor-react";
import { notificationApi, APIError, type Notification } from "@/lib/api-client";

interface NotificationBellProps {
  workspaceId: string;
  locale: string;
  initial: Notification[];
  initialUnread: number;
}

/**
 * In-app notification centre (NOT-002). Currently fed by the TSK-003 overdue
 * task sweep; the payload is read per type so new producers slot in without
 * changing the panel.
 *
 * Rendered from server-fetched data rather than polling: an overdue alert is
 * not time-critical to the second, and a 15-second poll on every page for
 * every user is real battery cost on the phones this app targets.
 */
export function NotificationBell({
  workspaceId,
  locale,
  initial,
  initialUnread,
}: NotificationBellProps) {
  const t = useTranslations("notifications");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>(initial);
  const [unread, setUnread] = useState(initialUnread);
  const [, startTransition] = useTransition();

  const markAllRead = () => {
    startTransition(async () => {
      try {
        await notificationApi.markAllRead(workspaceId);
        setItems((prev) =>
          prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
        );
        setUnread(0);
      } catch (err) {
        // A failed mark-read is not worth an error banner over the panel —
        // the badge simply stays, which is the honest state.
        console.error("notifications: mark all read failed", err instanceof APIError ? err.message : err);
      }
    });
  };

  // Renders one notification from its type + payload. Unknown types render
  // their title only, so a notification produced by a newer server version
  // degrades instead of crashing the panel.
  const renderBody = (n: Notification): string | null => {
    if (n.type === "task_overdue") {
      const due = n.payload.due_time
        ? `${n.payload.due_date} ${n.payload.due_time}`
        : n.payload.due_date;
      return t("taskOverdueBody", {
        task: n.payload.task_title ?? "",
        recipient: n.payload.recipient_name ?? "",
        due: due ?? "",
      });
    }
    return null;
  };

  const renderTitle = (n: Notification): string =>
    n.type === "task_overdue" ? t("taskOverdueTitle") : n.type;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("openAria", { count: unread })}
        aria-expanded={open}
        className="btn-base btn-secondary btn-icon touch-target relative"
      >
        <Bell size={20} weight="fill" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-error-ink)] px-1 text-xs font-bold text-[var(--color-text-inverse)]"
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("title")}
          className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t("title")}
            </h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-sm underline text-[var(--color-text-muted)]"
              >
                {t("markAllRead")}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">{t("empty")}</p>
          ) : (
            <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
              {items.map((n) => {
                const body = renderBody(n);
                const href = n.payload.recipient_id
                  ? `/${locale}/recipients/${n.payload.recipient_id}`
                  : null;
                const content = (
                  <>
                    <p className="text-sm font-semibold text-[var(--color-text)]">
                      {renderTitle(n)}
                    </p>
                    {body && (
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{body}</p>
                    )}
                  </>
                );
                return (
                  <li
                    key={n.id}
                    className={`rounded-lg border-2 p-2 ${
                      n.read_at
                        ? "border-[var(--color-border)]"
                        : "border-[var(--color-border-strong)]"
                    }`}
                  >
                    {href ? (
                      <Link href={href} onClick={() => setOpen(false)} className="block">
                        {content}
                      </Link>
                    ) : (
                      content
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
