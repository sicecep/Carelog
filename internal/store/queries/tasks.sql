-- Tasks (OWN-006 / TSK-001 / TSK-002): owner creates and assigns tasks to a
-- caregiver; caregiver advances the status; owner sees completion. Every
-- query is scoped by workspace so tenant isolation isn't a handler-level
-- concern.

-- name: CreateTask :one
-- Owner-side create. assigned_to may be NULL when the owner is drafting a
-- household reminder without picking a caregiver yet.
INSERT INTO tasks (
    workspace_id, recipient_id, assigned_to, created_by,
    title, description, due_date, due_time
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetTask :one
-- Workspace-scoped fetch. Returns nothing across workspaces, so a tenant
-- guessing an ID gets 404 not 403 (no existence leak).
SELECT * FROM tasks
WHERE id = $1 AND workspace_id = $2;

-- name: ListTasksForRecipient :many
-- Owner/viewer view: everything for one recipient in date/time order.
-- NULL due_time sorts LAST within a day (end-of-day sentinel).
SELECT * FROM tasks
WHERE workspace_id = $1 AND recipient_id = $2
ORDER BY due_date DESC, due_time ASC NULLS LAST, created_at DESC;

-- name: ListOpenTasksForAssignee :many
-- Caregiver home screen: everything I still owe, oldest-due first so the
-- overdue items surface at the top.
--
-- display_name is the optional nickname ("Dek Rara"); most recipients only
-- have full_name. COALESCE so the feed always has something to show — a bare
-- fallback to display_name renders a nameless task tile.
SELECT t.*, COALESCE(r.display_name, r.full_name) AS recipient_name
FROM tasks t
JOIN care_recipients r ON r.id = t.recipient_id
WHERE t.workspace_id = $1
  AND t.assigned_to = $2
  AND t.status <> 'done'
ORDER BY t.due_date ASC, t.due_time ASC NULLS LAST, t.created_at ASC;

-- name: UpdateTask :one
-- Owner-side edit of the mutable fields. Status is NOT edited here — status
-- transitions go through UpdateTaskStatus so the completed_at/by columns stay
-- consistent.
UPDATE tasks
SET title        = $3,
    description  = $4,
    assigned_to  = $5,
    due_date     = $6,
    due_time     = $7,
    updated_at   = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: UpdateTaskStatus :one
-- Transition status and keep the completion audit columns in sync. Setting
-- status='done' stamps completed_at/by; moving away from 'done' clears them,
-- so a task revived after a mistaken tick doesn't lie about when it finished.
UPDATE tasks
SET status = $3,
    completed_at = CASE WHEN $3 = 'done' THEN now() ELSE NULL END,
    completed_by = CASE WHEN $3 = 'done' THEN sqlc.narg('completed_by')::uuid ELSE NULL END,
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: DeleteTask :exec
-- Hard delete: owners can retract a task they created by mistake. Completion
-- history is not preserved for retracted tasks — the audit trail lives in the
-- report timeline, not here.
DELETE FROM tasks
WHERE id = $1 AND workspace_id = $2;
