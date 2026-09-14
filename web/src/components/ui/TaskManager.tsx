"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckSquare, Plus, Trash, PencilSimple } from "phosphor-react";
import { TASK_STATUSES, type TaskStatus } from "@/lib/constants.generated";
import {
  taskApi,
  APIError,
  type Task,
  type TaskInput,
  type AssignedCaregiver,
} from "@/lib/api-client";

interface TaskManagerProps {
  recipientId: string;
  workspaceId: string;
  /** Owners get the create/edit/delete controls; others get a read-only list. */
  canManage: boolean;
  /** Server-fetched tasks for this recipient. */
  tasks: Task[];
  /** Assignable caregivers — the picker draws only from people with access. */
  assignable: AssignedCaregiver[];
  /** Current user, so a caregiver viewing this page can advance their own tasks. */
  currentUserId: string;
}

function caregiverName(c: AssignedCaregiver): string {
  return c.full_name?.trim() || c.email;
}

/** YYYY-MM-DD in the browser's local date, for the default due date. */
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const EMPTY_FORM: TaskInput = {
  title: "",
  description: "",
  assigned_to: "",
  due_date: "",
  due_time: "",
};

/**
 * Task assignment panel (OWN-006 / TSK-001 / TSK-002).
 *
 * Owner: create, edit, delete tasks and pick who does them.
 * Caregiver: sees the list and can advance the status of tasks assigned to
 * them — the same tap-to-advance affordance as the home-screen tile, so the
 * flow is identical wherever they find the task.
 */
export function TaskManager({
  recipientId,
  workspaceId,
  canManage,
  tasks,
  assignable,
  currentUserId,
}: TaskManagerProps) {
  const t = useTranslations("tasks");
  const [list, setList] = useState<Task[]>(tasks);
  const [form, setForm] = useState<TaskInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const statusLabel = (s: TaskStatus): string =>
    s === "todo" ? t("statusTodo") : s === "in_progress" ? t("statusInProgress") : t("statusDone");

  const refresh = async () => {
    const res = await taskApi.listForRecipient(workspaceId, recipientId);
    setList(res.data ?? []);
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, due_date: todayISO() });
    setEditingId(null);
    setShowForm(true);
    setError(null);
  };

  const openEdit = (task: Task) => {
    setForm({
      title: task.title,
      description: task.description ?? "",
      assigned_to: task.assigned_to ?? "",
      due_date: task.due_date,
      due_time: task.due_time ?? "",
    });
    setEditingId(task.id);
    setShowForm(true);
    setError(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Empty optional fields must go to the API as undefined, not "": the Go
    // handler parses "" as a malformed date/UUID and 422s.
    const body: TaskInput = {
      title: form.title,
      due_date: form.due_date,
      description: form.description?.trim() ? form.description : undefined,
      assigned_to: form.assigned_to ? form.assigned_to : undefined,
      due_time: form.due_time ? form.due_time : undefined,
    };
    startTransition(async () => {
      try {
        if (editingId) {
          await taskApi.update(workspaceId, recipientId, editingId, body);
        } else {
          await taskApi.create(workspaceId, recipientId, body);
        }
        await refresh();
        closeForm();
      } catch (err) {
        if (err instanceof APIError && err.code === "invalid_assignee") {
          setError(t("errorAssignee"));
        } else {
          setError(err instanceof APIError ? err.message : t("errorGeneric"));
        }
      }
    });
  };

  const handleAdvance = (task: Task, next: TaskStatus) => {
    setError(null);
    startTransition(async () => {
      try {
        await taskApi.updateStatus(workspaceId, task.id, next);
        await refresh();
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      }
    });
  };

  const handleDelete = (task: Task) => {
    setError(null);
    startTransition(async () => {
      try {
        await taskApi.remove(workspaceId, recipientId, task.id);
        await refresh();
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      }
    });
  };

  // The next status in the lifecycle, mirroring domain.NextTaskStatus.
  const nextStatus = (s: TaskStatus): TaskStatus | null => {
    const i = TASK_STATUSES.indexOf(s);
    return i >= 0 && i + 1 < TASK_STATUSES.length ? TASK_STATUSES[i + 1] : null;
  };

  const canAdvance = (task: Task): boolean =>
    canManage || (!!task.assigned_to && task.assigned_to === currentUserId);

  return (
    <section aria-labelledby="tasks-heading" className="card">
      <div className="flex items-center justify-between gap-3">
        <h3
          id="tasks-heading"
          className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]"
        >
          <CheckSquare size={20} weight="fill" aria-hidden="true" />
          {t("recipientTitle")}
        </h3>
        {canManage && !showForm && (
          <button
            type="button"
            onClick={openCreate}
            className="btn-base btn-primary touch-target shrink-0 px-4"
          >
            <Plus size={20} weight="bold" aria-hidden="true" />
            <span className="hidden sm:inline">{t("add")}</span>
          </button>
        )}
      </div>

      {showForm && canManage && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="task-title"
              className="mb-1 block text-sm font-medium text-[var(--color-text)]"
            >
              {t("fieldTitle")}
            </label>
            <input
              id="task-title"
              type="text"
              required
              maxLength={100}
              value={form.title}
              placeholder={t("fieldTitlePlaceholder")}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input-base w-full"
            />
          </div>

          <div>
            <label
              htmlFor="task-description"
              className="mb-1 block text-sm font-medium text-[var(--color-text)]"
            >
              {t("fieldDescription")}
            </label>
            <textarea
              id="task-description"
              rows={2}
              maxLength={500}
              value={form.description ?? ""}
              placeholder={t("fieldDescriptionPlaceholder")}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-base w-full"
            />
          </div>

          <div>
            <label
              htmlFor="task-assignee"
              className="mb-1 block text-sm font-medium text-[var(--color-text)]"
            >
              {t("fieldAssignee")}
            </label>
            <select
              id="task-assignee"
              value={form.assigned_to ?? ""}
              onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              className="input-base w-full"
            >
              <option value="">{t("fieldAssigneeNobody")}</option>
              {assignable.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {caregiverName(c)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="task-due-date"
                className="mb-1 block text-sm font-medium text-[var(--color-text)]"
              >
                {t("fieldDueDate")}
              </label>
              <input
                id="task-due-date"
                type="date"
                required
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="input-base w-full"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="task-due-time"
                className="mb-1 block text-sm font-medium text-[var(--color-text)]"
              >
                {t("fieldDueTime")}
              </label>
              <input
                id="task-due-time"
                type="time"
                value={form.due_time ?? ""}
                onChange={(e) => setForm({ ...form, due_time: e.target.value })}
                className="input-base w-full"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || !form.title.trim() || !form.due_date}
              className="btn-base btn-primary touch-target flex-1"
            >
              {t("save")}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={pending}
              className="btn-base btn-secondary touch-target px-4"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

      {list.length === 0 ? (
        <p className="mt-3 text-base text-[var(--color-text-muted)]">{t("empty")}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {list.map((task) => {
            const next = nextStatus(task.status);
            const assignee = assignable.find((c) => c.user_id === task.assigned_to);
            return (
              <li
                key={task.id}
                className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-base font-semibold text-[var(--color-text)] ${
                        task.status === "done" ? "line-through opacity-60" : ""
                      }`}
                    >
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        {task.description}
                      </p>
                    )}
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      {task.due_date}
                      {task.due_time ? ` · ${task.due_time}` : ""}
                      {" · "}
                      {assignee ? caregiverName(assignee) : t("unassigned")}
                    </p>
                    <span className="mt-2 inline-block text-sm font-medium text-[var(--color-text)]">
                      {statusLabel(task.status)}
                    </span>
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(task)}
                        disabled={pending}
                        aria-label={t("editTitle")}
                        className="btn-base btn-secondary btn-icon touch-target"
                      >
                        <PencilSimple size={18} weight="bold" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(task)}
                        disabled={pending}
                        aria-label={t("deleteAria", { title: task.title })}
                        className="btn-base btn-danger btn-icon touch-target"
                      >
                        <Trash size={18} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                {canAdvance(task) && (
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
                    {task.status === "done" && (
                      <button
                        type="button"
                        onClick={() => handleAdvance(task, "todo")}
                        disabled={pending}
                        className="btn-base btn-secondary touch-target flex-1"
                      >
                        {t("reopen")}
                      </button>
                    )}
                  </div>
                )}
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
