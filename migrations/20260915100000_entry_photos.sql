-- +goose Up
-- CGR-008: photos attached to care log entries (meal quality, visible
-- symptoms). URLs come from the upload endpoint only; entry validation
-- enforces the host prefix, so nothing arbitrary can be injected here.
ALTER TABLE report_entries
    ADD COLUMN photo_urls TEXT[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE report_entries
    DROP COLUMN photo_urls;
