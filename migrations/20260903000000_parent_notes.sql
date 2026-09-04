-- +goose Up
-- Add parent_notes table for standing + daily instructions (WRK-003).

CREATE TABLE parent_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  note_type    TEXT NOT NULL CHECK (note_type IN ('standing', 'daily')),
  -- Standing notes: up to 1000 chars, persistent (note_date is NULL).
  -- Daily notes: up to 500 chars, visible only on note_date.
  content      TEXT NOT NULL,
  note_date    DATE, -- NULL for standing notes; required for daily notes
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_standing_no_date CHECK (
    (note_type = 'standing' AND note_date IS NULL) OR
    (note_type = 'daily' AND note_date IS NOT NULL)
  ),
  CONSTRAINT chk_content_length CHECK (
    (note_type = 'standing' AND char_length(content) <= 1000) OR
    (note_type = 'daily' AND char_length(content) <= 500)
  )
);

-- One standing note per recipient (it's a single persistent slot, editable in place).
CREATE UNIQUE INDEX idx_parent_notes_standing_unique ON parent_notes(recipient_id) WHERE note_type = 'standing';

-- One daily note per recipient per date.
CREATE UNIQUE INDEX idx_parent_notes_daily_unique ON parent_notes(recipient_id, note_date) WHERE note_type = 'daily';

CREATE INDEX idx_parent_notes_recipient ON parent_notes(recipient_id);

-- +goose Down
DROP TABLE IF EXISTS parent_notes;
