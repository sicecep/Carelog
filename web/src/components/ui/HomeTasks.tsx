"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CheckSquare } from "phosphor-react";
import { TASK_STATUSES, type TaskStatus } from "@/lib/constants.generated";
import { taskApi, APIError, type Task } from "@/lib/api-client";

interface HomeTasksProps {
  workspaceId: string;
  locale: string;
  /** Server-fetched open tasks assigned to the current user. */
  tasks: Task[];
  /** Owners see a workspace-wide heading; caregivers see "my tasks". */
  isOwner: boolean;
}

/**
 * The home-screen task list (PRD TSK-002: "Tasks section on home screen,
 * sorted by due time").
 *
 * Sorting is done server-side by the query (due_date, then due_time with NULL
 * last), so this renders in the order it receives — re-sorting here would let
 * the two disagree.
 *
 * A caregiver can advance a task straight from here without opening the
 * profile, which is the whole point of a home-screen section: the 3-tap
 * standard does not survive "find the child, scroll, then tap".
 */
export function HomeTasks({ workspaceId, locale, tasks, isOwner }: HomeTasksProps) {
  const t = useTranslations("tasks");
  const [list, setList] = useState<Task[]>(tasks);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const statusLabel = (s: TaskStatus): string =>
    s === "todo" ? t("statusTodo") : s === "in_progress" ? t("statusInProgress") : t("statusDone");

  const nextStatus = (s: TaskStatus): TaskStatus | null => {
    const i = TASK_STATUSES.indexOf(s);
    return i >= 0 && i + 1 < TASK_STATUSES.length ? TASK_STATUSES[i + 1] : null;
  };

  // Overdue is computed once per mount rather than during render: calling
  // Date.now() inside the render path is impure (React Compiler flags it, and
  // a re-render could reclassify a row mid-interaction). The authoritative
  // check lives in the TSK-003 sweep, which uses each workspace's timezone —
  // this is a visual hint, never a decision.
  const [now] = useState(() => Date.now());

  const isOverdue = (task: Task): boolean => {
    const due = task.due_time
      ? new Date(`${task.due_date}T${task.due_time}:00`)
      : new Date(`${task.due_date}T23:59:59`);
    return due.getTime() < now;
  };

  const handleAdvance = (task: Task, next: TaskStatus) => {
    setError(null);
    startTransition(async () => {
      try {
        await taskApi.updateStatus(workspaceId, task.id, next);
        // Done tasks leave the open-task feed entirely; anything else just
        // updates in place so the list does not jump under the user's thumb.
        setList((prev) =>
          next === "done"
            ? prev.filter((x) => x.id !== task.id)
            : prev.map((x) => (x.id === task.id ? { ...x, status: next } : x))
        );
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      }
    });
  };

  return (
    <section aria-labelledby="home-tasks-heading" className="card">
      <h2
        id="home-tasks-heading"
        className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]"
      >
        <CheckSquare size={20} weight="fill" aria-hidden="true" />
        {isOwner ? t("homeOwnerTitle") : t("homeTitle")}
      </h2>

      {list.length === 0 ? (
        <p className="mt-3 text-base text-[var(--color-text-muted)]">
          {isOwner ? t("homeOwnerEmpty") : t("homeEmpty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {list.map((task) => {
            const next = nextStatus(task.status);
            const overdue = isOverdue(task);
            return (
              <li
                key={task.id}
                className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              >
                <p className="text-base font-semibold text-[var(--color-text)]">
                  {task.title}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {task.recipient_name
                    ? t("forRecipient", { name: task.recipient_name })
                    : null}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {task.due_date}
                  {task.due_time ? ` · ${task.due_time}` : ""}
                  {" · "}
                  {statusLabel(task.status)}
                </p>
                {overdue && (
                  <p className="mt-1 text-sm font-semibold text-[var(--color-error-ink)]">
                    {t("overdue")}
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  {next && (
                    <button
                      type="button"
                      onClick={() => handleAdvance(task, next)}
                      disabled={pending}
                      className="btn-base btn-primary touch-target flex-1"
                    >
                      {t("advanceTo", { status: statusLabel(next) })}
                    </button>
                  )}
                  <Link
                    href={`/${locale}/recipients/${task.recipient_id}`}
                    className="btn-base btn-secondary touch-target px-4"
                  >
                    {t("viewAll")}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-error-ink)]">
          {error}
        </p>
      )}
    </section>
  );
}
