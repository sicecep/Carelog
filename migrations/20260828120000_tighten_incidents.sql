-- +goose Up
-- Tighten existing incidents table: add constraints and action_taken column.
ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS action_taken TEXT CHECK (char_length(action_taken) <= 500),
    ADD CONSTRAINT incident_severity_check CHECK (severity IN ('low', 'medium', 'high', 'emergency')),
    ADD CONSTRAINT incident_description_check CHECK (char_length(description) >= 20 AND char_length(description) <= 1000);

-- Ensure reporter_id has FK constraint (was previously just a UUID, assume column exists)
ALTER TABLE incidents
    ADD CONSTRAINT incidents_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE incidents
    DROP CONSTRAINT IF EXISTS incident_severity_check,
    DROP CONSTRAINT IF EXISTS incident_description_check,
    DROP CONSTRAINT IF EXISTS incidents_reporter_id_fkey,
    DROP COLUMN IF EXISTS action_taken;
