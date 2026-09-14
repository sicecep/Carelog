-- +goose Up
-- In-app notifications (NOT-002) with TSK-003 (overdue task alert) as the
-- first producer.
--
-- Built generically rather than as a tasks-only table: NOT-002 specifies a
-- notification centre listing every kind of event (incidents, assignments,
-- overdue tasks) in one reverse-chronological feed, so a per-feature table
-- would have to be unioned back together immediately.
--
-- Delivery is per USER, not per workspace: a workspace with two owners must
-- produce a row each, so "mark as read" is one person's action rather than
-- something that silently clears the badge for everyone.
CREATE TABLE notifications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Event discriminator. Mirrors domain.NotificationType; the UI picks an
    -- icon and a link from it.
    type         TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 50),
    -- The row the notification is ABOUT (a task, an incident...). Untyped by
    -- design: a FK per possible subject would need a column per feature, and
    -- the producer already knows what it enqueued. Nullable for notifications
    -- that reference nothing.
    subject_id   UUID,
    -- Rendering data (task title, recipient name, due time...). Stored rather
    -- than joined so a notification still reads correctly after the subject is
    -- edited or deleted — "Task X is overdue" must not become blank because
    -- the owner later renamed or retracted the task.
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The notification centre query: newest first for one user.
CREATE INDEX idx_notifications_user_created
    ON notifications(user_id, created_at DESC);

-- The unread badge count. Partial so it stays small as read rows accumulate.
CREATE INDEX idx_notifications_unread
    ON notifications(user_id) WHERE read_at IS NULL;

-- TSK-003 acceptance criterion 2, "sent once per overdue task", enforced by
-- the DATABASE rather than by the job's bookkeeping. The overdue sweep runs on
-- a timer: without this, a restart, an overlapping tick, or a retry re-notifies
-- and the owner gets the same alert repeatedly. A unique index makes the second
-- insert fail no matter which of those happens.
--
-- Scoped to (user, type, subject) so the same task can still produce a
-- different KIND of notification later, and two owners each get their own.
CREATE UNIQUE INDEX idx_notifications_once_per_subject
    ON notifications(user_id, type, subject_id)
    WHERE subject_id IS NOT NULL;

-- +goose Down
DROP TABLE notifications;
