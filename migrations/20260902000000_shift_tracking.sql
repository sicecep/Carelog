-- +goose Up
-- Add caregiver_assignments and shifts tables for shift tracking.

-- caregiver_assignments: owner links caregivers to profiles
CREATE TABLE caregiver_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  caregiver_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, caregiver_id)
);

CREATE INDEX idx_caregiver_assignments_caregiver ON caregiver_assignments(caregiver_id) WHERE is_active;

-- shifts: caregiver check-in/out
CREATE TABLE shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  caregiver_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ NOT NULL,
  checked_out_at  TIMESTAMPTZ,
  handoff_note    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_caregiver_active ON shifts(caregiver_id) WHERE checked_out_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS caregiver_assignments;
