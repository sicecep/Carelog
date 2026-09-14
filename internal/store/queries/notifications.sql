-- In-app notifications (NOT-002) and the TSK-003 overdue sweep.

-- name: CreateNotification :one
-- Insert a notification, silently skipping one that already exists for this
-- (user, type, subject). That ON CONFLICT is TSK-003's "sent once per overdue
-- task" guarantee: the overdue sweep runs on a timer, so a restart, an
-- overlapping tick or an asynq retry would otherwise re-alert the owner.
-- Returns no row when the notification was already sent, which callers use to
-- count what was actually delivered.
INSERT INTO notifications (workspace_id, user_id, type, subject_id, payload)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, type, subject_id) WHERE subject_id IS NOT NULL
DO NOTHING
RETURNING *;

-- name: ListNotificationsForUser :many
-- NOT-002: the notification centre, newest first.
SELECT * FROM notifications
WHERE user_id = $1 AND workspace_id = $2
ORDER BY created_at DESC
LIMIT $3;

-- name: CountUnreadNotifications :one
-- NOT-002: the unread badge.
SELECT count(*) FROM notifications
WHERE user_id = $1 AND workspace_id = $2 AND read_at IS NULL;

-- name: MarkNotificationRead :one
-- Scoped by user so one member cannot clear another's badge.
UPDATE notifications
SET read_at = now()
WHERE id = $1 AND user_id = $2 AND read_at IS NULL
RETURNING *;

-- name: MarkAllNotificationsRead :exec
UPDATE notifications
SET read_at = now()
WHERE user_id = $1 AND workspace_id = $2 AND read_at IS NULL;

-- name: ListOverdueTasks :many
-- TSK-003: tasks whose due moment has passed while still not done.
--
-- The comparison is built in the WORKSPACE's timezone, not the server's: a due
-- date of "today" with no due time means end of that day in Jakarta, and
-- treating it as UTC would fire the alert 7 hours early for every Indonesian
-- household. A NULL due_time therefore means 23:59:59 local, so an all-day
-- task is only overdue once its day is genuinely over.
--
-- Returns the owners to notify alongside the task: every owner of the
-- workspace gets the alert (PRD says "the owner"; a workspace may have more
-- than one, and silently picking the first would drop the others).
SELECT
    t.id            AS task_id,
    t.workspace_id,
    t.title,
    t.due_date,
    t.due_time,
    t.assigned_to,
    r.id            AS recipient_id,
    COALESCE(r.display_name, r.full_name) AS recipient_name,
    m.user_id       AS owner_id
FROM tasks t
JOIN care_recipients r ON r.id = t.recipient_id
JOIN workspaces w      ON w.id = t.workspace_id
JOIN workspace_members m ON m.workspace_id = t.workspace_id AND m.role = 'owner'
WHERE t.status <> 'done'
  AND (
        (t.due_date + COALESCE(t.due_time, TIME '23:59:59'))
        AT TIME ZONE w.timezone
      ) < now()
ORDER BY t.due_date, t.due_time NULLS LAST;
