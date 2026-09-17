-- +goose Up
-- CGR-015: photos on incident reports.
--
-- Mirrors report_entries.photo_urls (CGR-008) deliberately — same column
-- type, same NOT NULL DEFAULT '{}', same validation and host-prefix checks
-- in the service layer. An incident is exactly the case where a photo is
-- worth more than the 1000-char description: a fall, a bruise, a spill.

-- +goose StatementBegin
ALTER TABLE incidents
    ADD COLUMN photo_urls TEXT[] NOT NULL DEFAULT '{}';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE incidents
    DROP COLUMN photo_urls;
-- +goose StatementEnd
