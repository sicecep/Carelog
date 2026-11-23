-- Optional body measurements on a care recipient's profile.
--
-- Both are nullable: an owner may leave them empty at setup and fill them in
-- later (or clear them again). Units are fixed by the column name. The range
-- CHECKs mirror domain.RecipientWeight / domain.RecipientHeight, so the API
-- rejects a bad value with a 400 before it ever reaches these constraints.
--
-- These are the profile's "current" values, not a history: dated weigh-ins
-- belong in the health vitals log (subcategory "weight").

-- +goose Up
ALTER TABLE care_recipients
    ADD COLUMN weight_kg NUMERIC(5, 2) CHECK (weight_kg BETWEEN 0.5 AND 300),
    ADD COLUMN height_cm NUMERIC(4, 1) CHECK (height_cm BETWEEN 20 AND 250);

-- +goose Down
ALTER TABLE care_recipients
    DROP COLUMN height_cm,
    DROP COLUMN weight_kg;
