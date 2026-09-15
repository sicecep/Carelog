-- +goose Up
-- AUTH-005: caregiver phone + device-bound PIN.
--
-- A 6-digit PIN is only 10^6 values. It is acceptable here because it is
-- never a standalone credential: authentication requires the PIN (knowledge)
-- AND an enrolled device secret (possession). These tables carry both halves
-- plus the lockout state that bounds online guessing.

-- +goose StatementBegin
CREATE TABLE user_pins (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- argon2id PHC string; parameters travel with the hash so they can be
    -- raised later without invalidating existing PINs.
    pin_hash     TEXT NOT NULL,
    failed_count INT NOT NULL DEFAULT 0,
    -- Set when failed_count crosses the threshold; NULL means not locked.
    locked_until TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Devices a user has enrolled. The raw secret lives only in the client's
-- httpOnly cookie; we store its SHA-256 so a database leak does not yield
-- usable device tokens.
CREATE TABLE trusted_devices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   BYTEA NOT NULL UNIQUE,
    label        TEXT,
    last_seen_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trusted_devices_user ON trusted_devices(user_id) WHERE revoked_at IS NULL;

-- Forgot-PIN requests, approved by an owner.
--
-- Deliberately NOT self-service: an unauthenticated stranger who knows a
-- phone number could otherwise spam an owner with prompts, and one
-- distracted tap would hand over the account. Approval grants a single-use,
-- short-lived re-enrolment token — never a session — and the caregiver must
-- still set a new PIN on the requesting device.
CREATE TABLE pin_reset_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- The device that asked. The approval is bound to it, so approving
    -- cannot help an attacker on a different device.
    device_hash   BYTEA NOT NULL,
    device_label  TEXT,
    requested_ip  INET,
    status        TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'used', 'expired')),
    -- Set on approval: SHA-256 of the one-time re-enrolment token.
    reset_hash    BYTEA,
    approved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at   TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pin_reset_pending ON pin_reset_requests(workspace_id, created_at)
    WHERE status = 'pending';

-- One open request per user: re-asking updates the existing row rather than
-- queueing a second prompt for the owner to approve twice.
CREATE UNIQUE INDEX idx_pin_reset_one_pending ON pin_reset_requests(user_id)
    WHERE status = 'pending';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS pin_reset_requests;
DROP TABLE IF EXISTS trusted_devices;
DROP TABLE IF EXISTS user_pins;
-- +goose StatementEnd
