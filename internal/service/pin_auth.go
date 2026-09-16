package service

import (
	"context"
	"net/http"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/auth"
	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// Caregiver phone + PIN authentication (AUTH-005).
//
// The security model in one line: the PIN is NEVER a standalone credential.
// Authentication requires a valid PIN (knowledge) presented from an enrolled
// device (possession). That is what makes a 6-digit secret defensible — on
// its own it would be a 10^6 password accepted from anywhere on the
// internet.

const (
	// PINMaxAttempts before the account locks.
	PINMaxAttempts = 5
	// PINLockDuration is the lockout applied once attempts are exhausted.
	PINLockDuration = 15 * time.Minute
	// PINResetRequestTTL bounds how long an unapproved request is offered
	// to the owner.
	PINResetRequestTTL = 24 * time.Hour
	// PINResetTokenTTL bounds the approved token. Short: the caregiver is
	// standing there waiting, and a long window is an unattended key.
	PINResetTokenTTL = 15 * time.Minute
	// deviceTokenBytes is the entropy of a device secret. 32 bytes is far
	// beyond guessing; the PIN supplies the human-memorable half.
	deviceTokenBytes = 32
)

// PIN auth errors implement the apiError contract (Code/Message/Status) so
// mapError renders each as the right HTTP status instead of a 500. The codes
// are coarse by design — the distinctions live in logs, not in responses
// that an attacker could mine.

// ErrPINNotSet means the user has no PIN enrolled. This one IS account
// existence-revealing; the 5/15m-per-IP limit on the endpoint bounds the
// probing, and the client needs it to route to enrolment.
type ErrPINNotSet struct{}

func (ErrPINNotSet) Error() string { return "pin not set" }
func (ErrPINNotSet) Code() string  { return "pin_not_set" }
func (ErrPINNotSet) Message() string {
	return "no PIN set for this account — enrol first"
}
func (ErrPINNotSet) Status() int { return http.StatusUnauthorized }

// ErrPINLocked means too many failed attempts.
type ErrPINLocked struct{}

func (ErrPINLocked) Error() string { return "pin locked" }
func (ErrPINLocked) Code() string  { return "pin_locked" }
func (ErrPINLocked) Message() string {
	return "too many attempts — try again in 15 minutes"
}
func (ErrPINLocked) Status() int { return http.StatusTooManyRequests }

// ErrPINIncorrect covers both a wrong PIN and an unknown phone — the caller
// must not be able to tell which.
type ErrPINIncorrect struct{}

func (ErrPINIncorrect) Error() string { return "pin incorrect" }
func (ErrPINIncorrect) Code() string  { return "invalid_credentials" }
func (ErrPINIncorrect) Message() string {
	return "phone number or PIN is incorrect"
}
func (ErrPINIncorrect) Status() int { return http.StatusUnauthorized }

// ErrDeviceNotTrusted means the PIN was correct but this device is not
// enrolled: the possession factor is missing.
type ErrDeviceNotTrusted struct{}

func (ErrDeviceNotTrusted) Error() string { return "device not trusted" }
func (ErrDeviceNotTrusted) Code() string  { return "device_not_trusted" }
func (ErrDeviceNotTrusted) Message() string {
	return "this device is not enrolled — ask the owner for a new invite link"
}
func (ErrDeviceNotTrusted) Status() int { return http.StatusUnauthorized }

// ErrResetNotApproved covers a missing, unapproved, expired, already used,
// or wrong-device reset token.
type ErrResetNotApproved struct{}

func (ErrResetNotApproved) Error() string { return "reset not approved" }
func (ErrResetNotApproved) Code() string  { return "reset_not_approved" }
func (ErrResetNotApproved) Message() string {
	return "this reset is not approved, expired, or already used"
}
func (ErrResetNotApproved) Status() int { return http.StatusBadRequest }

// PINAuthDeps carries what the PIN flows need.
type PINAuthDeps struct {
	Queries store.Querier
}

// hashToken returns the SHA-256 of a raw secret. Device and reset tokens are
// stored hashed so a database leak yields nothing usable.
func hashToken(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

// newToken mints a URL-safe random secret.
func newToken() (string, error) {
	b := make([]byte, deviceTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// SetPIN stores a new PIN for the user and enrols the calling device.
//
// Returns the raw device token, which the caller puts in an httpOnly cookie.
// It is the only time the secret exists outside the client.
func (d PINAuthDeps) SetPIN(ctx context.Context, userID uuid.UUID, pin, deviceLabel string) (string, error) {
	hash, err := auth.HashPIN(pin)
	if err != nil {
		// Shape/weakness failures are user-correctable input errors.
		return "", ErrValidation{Errors: []RecipientError{{Field: "pin", Message: pinErrorMessage(err)}}}
	}
	if _, err := d.Queries.UpsertUserPIN(ctx, store.UpsertUserPINParams{
		UserID:  userID,
		PinHash: hash,
	}); err != nil {
		return "", fmt.Errorf("store pin: %w", err)
	}
	return d.EnrolDevice(ctx, userID, deviceLabel)
}

// EnrolDevice registers a device as a possession factor and returns its raw
// secret.
func (d PINAuthDeps) EnrolDevice(ctx context.Context, userID uuid.UUID, label string) (string, error) {
	raw, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := d.Queries.CreateTrustedDevice(ctx, store.CreateTrustedDeviceParams{
		UserID:    userID,
		TokenHash: hashToken(raw),
		Label:     pgtype.Text{String: label, Valid: label != ""},
	}); err != nil {
		return "", fmt.Errorf("enrol device: %w", err)
	}
	return raw, nil
}

// VerifyPINLogin authenticates phone + PIN from an enrolled device.
//
// Order matters. The device check runs AFTER the PIN check so that a
// correct-PIN-wrong-device attempt still burns an attempt and is
// indistinguishable in timing from a wrong PIN; checking the device first
// would let an attacker probe PINs from anywhere without consuming the
// lockout budget.
func (d PINAuthDeps) VerifyPINLogin(ctx context.Context, rawPhone, pin, deviceToken string) (store.User, error) {
	phone, err := domain.NormalizePhone(rawPhone)
	if err != nil {
		return store.User{}, ErrPINIncorrect{}
	}

	user, err := d.Queries.GetUserByPhone(ctx, pgtype.Text{String: phone, Valid: true})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Unknown phone is reported exactly like a wrong PIN: telling
			// them apart is an account-enumeration oracle.
			return store.User{}, ErrPINIncorrect{}
		}
		return store.User{}, fmt.Errorf("lookup phone: %w", err)
	}

	rec, err := d.Queries.GetUserPIN(ctx, user.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.User{}, ErrPINNotSet{}
		}
		return store.User{}, fmt.Errorf("lookup pin: %w", err)
	}

	if rec.LockedUntil.Valid && rec.LockedUntil.Time.After(time.Now()) {
		return store.User{}, ErrPINLocked{}
	}

	ok, err := auth.VerifyPIN(pin, rec.PinHash)
	if err != nil {
		// A malformed stored hash must fail closed, loudly — never
		// authenticate.
		return store.User{}, fmt.Errorf("verify pin: %w", err)
	}
	if !ok {
		if _, ferr := d.Queries.RecordPINFailure(ctx, store.RecordPINFailureParams{
			UserID:      user.ID,
			MaxAttempts: PINMaxAttempts,
			LockSeconds: int32(PINLockDuration.Seconds()),
		}); ferr != nil {
			return store.User{}, fmt.Errorf("record pin failure: %w", ferr)
		}
		return store.User{}, ErrPINIncorrect{}
	}

	// PIN is right. Now the possession factor.
	if deviceToken == "" {
		return store.User{}, ErrDeviceNotTrusted{}
	}
	dev, err := d.Queries.GetTrustedDeviceByHash(ctx, hashToken(deviceToken))
	if err != nil || dev.UserID != user.ID {
		// Wrong or revoked device, or a device belonging to someone else.
		// Still counts as a failed attempt: otherwise an attacker with the
		// right PIN could retry forever from unenrolled devices.
		if _, ferr := d.Queries.RecordPINFailure(ctx, store.RecordPINFailureParams{
			UserID:      user.ID,
			MaxAttempts: PINMaxAttempts,
			LockSeconds: int32(PINLockDuration.Seconds()),
		}); ferr != nil {
			return store.User{}, fmt.Errorf("record device failure: %w", ferr)
		}
		return store.User{}, ErrDeviceNotTrusted{}
	}

	if err := d.Queries.ClearPINFailures(ctx, user.ID); err != nil {
		return store.User{}, fmt.Errorf("clear pin failures: %w", err)
	}
	_ = d.Queries.TouchTrustedDevice(ctx, dev.ID)
	return user, nil
}

// RequestPINReset records a caregiver's forgot-PIN request for owner
// approval, binding it to the device that asked.
//
// The request itself grants nothing: it only surfaces a prompt to the owner.
func (d PINAuthDeps) RequestPINReset(ctx context.Context, rawPhone, deviceLabel, ip string) error {
	phone, err := domain.NormalizePhone(rawPhone)
	if err != nil {
		// Silent success: confirming which numbers exist would turn this
		// endpoint into a user-enumeration oracle.
		return nil
	}
	user, err := d.Queries.GetUserByPhone(ctx, pgtype.Text{String: phone, Valid: true})
	if err != nil {
		return nil //nolint:nilerr // deliberate: never reveal whether the phone exists
	}

	memberships, err := d.Queries.ListWorkspacesForUser(ctx, user.ID)
	if err != nil || len(memberships) == 0 {
		return nil //nolint:nilerr // nobody to approve it
	}

	// The device that will be re-enrolled on approval.
	raw, err := newToken()
	if err != nil {
		return err
	}

	// INET column: pgx wants a *netip.Addr. A malformed IP is dropped
	// rather than failing the request — the address is forensic detail for
	// the owner, not a control.
	var addr *netip.Addr
	if ip != "" {
		if parsed, perr := netip.ParseAddr(ip); perr == nil {
			addr = &parsed
		}
	}

	if _, err := d.Queries.CreatePINResetRequest(ctx, store.CreatePINResetRequestParams{
		UserID:      user.ID,
		WorkspaceID: memberships[0].Workspace.ID,
		DeviceHash:  hashToken(raw),
		DeviceLabel: pgtype.Text{String: deviceLabel, Valid: deviceLabel != ""},
		RequestedIp: addr,
		ExpiresAt:   pgtype.Timestamptz{Time: time.Now().Add(PINResetRequestTTL), Valid: true},
	}); err != nil {
		return fmt.Errorf("create reset request: %w", err)
	}
	return nil
}

func pinErrorMessage(err error) string {
	switch {
	case errors.Is(err, auth.ErrPINWeak):
		return "choose a less predictable PIN"
	case errors.Is(err, auth.ErrPINFormat):
		return "PIN must be exactly 6 digits"
	default:
		return "invalid PIN"
	}
}

// ApprovePINReset is the owner's decision. It mints a single-use token bound
// to the requesting device and returns it so the API can hand it back to
// that device (never to the approver).
func (d PINAuthDeps) ApprovePINReset(ctx context.Context, requestID, workspaceID, approverID uuid.UUID) (string, error) {
	raw, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := d.Queries.ApprovePINReset(ctx, store.ApprovePINResetParams{
		ID:          requestID,
		WorkspaceID: workspaceID,
		ResetHash:   hashToken(raw),
		ApprovedBy:  pgtype.UUID{Bytes: approverID, Valid: true},
		// Approval starts the SHORT clock: the caregiver is present and
		// waiting, so a long window would just be an unattended key.
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(PINResetTokenTTL), Valid: true},
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Already approved/denied/expired, or not this workspace's
			// request. Guarded in SQL so it cannot be re-approved into a
			// second live token.
			return "", ErrResetNotApproved{}
		}
		return "", fmt.Errorf("approve reset: %w", err)
	}
	return raw, nil
}

// CompletePINReset redeems an approved token and sets the new PIN.
//
// Three things must hold: the token matches, it is still approved and
// unexpired, and it is being redeemed from the SAME device that asked. The
// device check is what stops an intercepted token being useful elsewhere.
// Consuming and re-enrolling happen together, and every previously trusted
// device is revoked — if the caregiver lost the phone, the old one must stop
// working.
func (d PINAuthDeps) CompletePINReset(ctx context.Context, resetToken, deviceToken, newPIN, deviceLabel string) (uuid.UUID, string, error) {
	if resetToken == "" || deviceToken == "" {
		return uuid.Nil, "", ErrResetNotApproved{}
	}
	req, err := d.Queries.ConsumePINReset(ctx, store.ConsumePINResetParams{
		ResetHash:  hashToken(resetToken),
		DeviceHash: hashToken(deviceToken),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, "", ErrResetNotApproved{}
		}
		return uuid.Nil, "", fmt.Errorf("consume reset: %w", err)
	}

	// Validate before revoking anything, so a rejected PIN does not strand
	// the user with no devices and a spent token.
	hash, err := auth.HashPIN(newPIN)
	if err != nil {
		return uuid.Nil, "", ErrValidation{Errors: []RecipientError{{Field: "pin", Message: pinErrorMessage(err)}}}
	}

	if err := d.Queries.RevokeAllTrustedDevices(ctx, req.UserID); err != nil {
		return uuid.Nil, "", fmt.Errorf("revoke devices: %w", err)
	}
	if _, err := d.Queries.UpsertUserPIN(ctx, store.UpsertUserPINParams{
		UserID:  req.UserID,
		PinHash: hash,
	}); err != nil {
		return uuid.Nil, "", fmt.Errorf("store pin: %w", err)
	}
	newDevice, err := d.EnrolDevice(ctx, req.UserID, deviceLabel)
	if err != nil {
		return uuid.Nil, "", err
	}
	return req.UserID, newDevice, nil
}
