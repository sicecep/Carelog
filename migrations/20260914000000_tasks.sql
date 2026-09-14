-- +goose Up
-- OWN-006 / TSK-001 / TSK-002: owner assigns tasks to a caregiver, caregiver
-- advances the status, owner sees completion.
--
-- assigned_to is nullable so an owner can create an unassigned task (a
-- reminder for the household) without inventing a placeholder caregiver. It is
-- ON DELETE SET NULL rather than CASCADE: when a caregiver account is deleted,
-- the task history for the recipient must survive — losing "was this done?"
-- because the person left is exactly the audit gap CareLog exists to close.
--
-- Status is a CHECK-constrained TEXT rather than a Postgres enum: adding a
-- value to an enum needs a migration that cannot run inside a transaction
-- block, and goose wraps migrations in one. The allowed set mirrors
-- domain.TaskStatus, which is the single source of truth in Go.
CREATE TABLE tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
    assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    description  TEXT CHECK (char_length(description) <= 500),
    due_date     DATE NOT NULL,
    -- Nullable: PRD TSK-001 makes due time optional ("before bedtime" tasks
    -- have a date but no clock time). Sorting treats NULL as end-of-day.
    due_time     TIME,
    status       TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done')),
    -- Set when status becomes 'done', cleared if it moves back. Kept as a
    -- column instead of derived from updated_at so "when was this actually
    -- completed" survives later edits to the task.
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The owner's view: tasks for one recipient on one day, in due order.
CREATE INDEX idx_tasks_recipient_due ON tasks(recipient_id, due_date);

-- The caregiver's home screen: "my open tasks", partial so the index stays
-- small as completed tasks accumulate.
CREATE INDEX idx_tasks_assignee_open ON tasks(assigned_to, due_date)
    WHERE status <> 'done';

-- +goose Down
DROP TABLE tasks;
