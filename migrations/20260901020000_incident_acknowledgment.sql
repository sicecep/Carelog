-- +goose Up
-- Incident acknowledgment (PRD §6.5 P1, INC-ACK): the owner acknowledges an
-- incident, optionally leaving a comment for the caregiver. Status is
-- derived: an incident is acknowledged iff acknowledged_at IS NOT NULL —
-- no separate status column to drift out of sync.
ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ack_comment TEXT CHECK (char_length(ack_comment) <= 500);

-- +goose Down
ALTER TABLE incidents
    DROP COLUMN IF EXISTS ack_comment,
    DROP COLUMN IF EXISTS acknowledged_at,
    DROP COLUMN IF EXISTS acknowledged_by;
