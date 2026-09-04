-- +goose Up
-- Caregiver invitations (WRK-004 / SEC-003).
--
-- Security model mirrors auth_magic_links: only the SHA-256 hash of the token
-- is ever stored, so a database leak cannot be replayed as a valid invite.
-- Tokens are single-use (consumed_at) and expire after 72 hours per SEC-003.

CREATE TABLE invitations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    recipient_id  UUID REFERENCES care_recipients(id) ON DELETE CASCADE,
    token_hash    BYTEA NOT NULL UNIQUE,
    invitee_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'caregiver' CHECK (role IN ('caregiver', 'viewer')),
    invited_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    consumed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_workspace ON invitations(workspace_id);
CREATE INDEX idx_invitations_pending ON invitations(workspace_id)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS invitations;
