package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/auth"
	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// Caregiver phone-or-username + PIN authentication (AUTH-005, login revamp
// D3/D4).
//
// The PIN works from any device (D4), so the identifier + PIN is the whole
// credential. What keeps a 6-digit secret defensible is the hardening in
// spec §6: a per-account lockout with doubling backoff (this file), per-IP
// limits (the handler), a common-PIN blocklist (internal/auth), and owner
// alerts on a lock or a sign-in from a new device. trusted_devices no longer
// gates login; it only remembers which devices are known.

const (
	// PINMaxAttempts before the account locks.
	PINMaxAttempts = 5
	// PINLockBase is the first lock; each further lock in a row doubles it.
	PINLockBase = 15 * time.Minute
	// PINLockCap bounds the doubling (D7).
	PINLockCap = 24 * time.Hour
	// PINResetRequestTTL bounds how long an unapproved request is offered
	// to the owner.
	PINResetRequestTTL = 24 * time.Hour
	// PINResetTokenTTL bounds the approved token. Short: the caregiver is
	// standing there waiting, and a long window is an unattended key.
	PINResetTokenTTL = 15 * time.Minute
	// deviceTokenBytes is the entropy of a device secret.
	deviceTokenBytes = 32
)

// PIN auth errors implement the apiError contract (Code/Message/Status) so
// mapError renders each as the right HTTP status instead of a 500. The codes
// are coarse by design — the distinctions live in logs, not in responses
// that an attacker could mine.

// ErrPINLocked means too many failed attempts. The lock length varies with
// the backoff level, so the message names no duration.
type ErrPINLocked struct{}

func (ErrPINLocked) Error() string { return "pin locked" }
func (ErrPINLocked) Code() string  { return "pin_locked" }
func (ErrPINLocked) Message() string {
	return "too many attempts — try again later, or ask the owner to unlock"
}
func (ErrPINLocked) Status() int { return http.StatusTooManyRequests }

// ErrPINIncorrect covers a wrong PIN, an unknown identifier, and an account
// with no PIN — the caller must not be able to tell which.
type ErrPINIncorrect struct{}

func (ErrPINIncorrect) Error() string { return "pin incorrect" }
func (ErrPINIncorrect) Code() string  { return "invalid_credentials" }
func (ErrPINIncorrect) Message() string {
	return "phone number, username or PIN is incorrect"
}
func (ErrPINIncorrect) Status() int { return http.StatusUnauthorized }

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

// PINLoginResult is a successful caregiver sign-in.
type PINLoginResult struct {
	User store.User
	// DeviceToken is set when this device was not known for the user: the
	// caller stores it in the device cookie so the next sign-in from here
	// is recognised and raises no alert.
	DeviceToken string
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

// hashPINFor validates pin for the given account and hashes it. Validation
// errors come back as ErrValidation so the client can show them.
func hashPINFor(pin, phone string) (string, error) {
	if err := auth.ValidatePINFor(pin, phone); err != nil {
		return "", ErrValidation{Errors: []RecipientError{{Field: "pin", Message: pinErrorMessage(err)}}}
	}
	hash, err := auth.HashPIN(pin)
	if err != nil {
		return "", fmt.Errorf("hash pin: %w", err)
	}
	return hash, nil
}

// SetPIN stores a new PIN for the user and enrols the calling device.
//
// Returns the raw device token, which the caller puts in an httpOnly cookie.
// It is the only time the secret exists outside the client.
func (d PINAuthDeps) SetPIN(ctx context.Context, userID uuid.UUID, pin, deviceLabel string) (string, error) {
	user, err := d.Queries.GetUser(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("get user: %w", err)
	}
	hash, err := hashPINFor(pin, user.Phone.String)
	if err != nil {
		return "", err
	}
	if _, err := d.Queries.UpsertUserPIN(ctx, store.UpsertUserPINParams{
		UserID:  userID,
		PinHash: hash,
	}); err != nil {
		return "", fmt.Errorf("store pin: %w", err)
	}
	return d.EnrolDevice(ctx, userID, deviceLabel)
}

// EnrolDevice records a device as known for the user and returns its raw
// secret.
func (d PINAuthDeps) EnrolDevice(ctx context.Context, userID uuid.UUID, label string) (string, error) {
	_, raw, err := d.enrolDevice(ctx, userID, label)
	return raw, err
}

func (d PINAuthDeps) enrolDevice(ctx context.Context, userID uuid.UUID, label string) (uuid.UUID, string, error) {
	raw, err := newToken()
	if err != nil {
		return uuid.Nil, "", err
	}
	dev, err := d.Queries.CreateTrustedDevice(ctx, store.CreateTrustedDeviceParams{
		UserID:    userID,
		TokenHash: hashToken(raw),
		Label:     pgtype.Text{String: label, Valid: label != ""},
	})
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("enrol device: %w", err)
	}
	return dev.ID, raw, nil
}

// lookupCaregiver resolves the login identifier to an account. found=false
// covers both an unknown account and an identifier that is neither a phone
// nor a valid username; callers treat them identically.
func (d PINAuthDeps) lookupCaregiver(ctx context.Context, identifier string) (store.User, bool, error) {
	kind, value := domain.ParseCaregiverIdentifier(identifier)
	var (
		user store.User
		err  error
	)
	switch kind {
	case domain.IdentifierPhone:
		user, err = d.Queries.GetUserByPhone(ctx, pgtype.Text{String: value, Valid: true})
	case domain.IdentifierUsername:
		user, err = d.Queries.GetUserByUsername(ctx, value)
	default:
		return store.User{}, false, nil
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.User{}, false, nil
		}
		return store.User{}, false, fmt.Errorf("lookup caregiver: %w", err)
	}
	return user, true, nil
}

// checkPIN verifies pin against the user's stored PIN and applies the
// lockout. It returns ErrPINIncorrect for a missing PIN or a wrong one, and
// ErrPINLocked while a lock is active. A wrong PIN that triggers a lock
// alerts the owners.
func (d PINAuthDeps) checkPIN(ctx context.Context, user store.User, pin string) error {
	rec, err := d.Queries.GetUserPIN(ctx, user.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No PIN reads like a wrong PIN, timing included: with
			// usernames, "pin_not_set" would confirm the account exists.
			auth.BurnPasswordCheck(pin)
			return ErrPINIncorrect{}
		}
		return fmt.Errorf("lookup pin: %w", err)
	}

	if rec.LockedUntil.Valid && rec.LockedUntil.Time.After(time.Now()) {
		return ErrPINLocked{}
	}

	ok, err := auth.VerifyPIN(pin, rec.PinHash)
	if err != nil {
		// A malformed stored hash must fail closed, loudly.
		return fmt.Errorf("verify pin: %w", err)
	}
	if !ok {
		justLocked, ferr := d.Queries.RecordPINFailure(ctx, store.RecordPINFailureParams{
			UserID:      user.ID,
			MaxAttempts: PINMaxAttempts,
			BaseSeconds: int64(PINLockBase.Seconds()),
			CapSeconds:  int64(PINLockCap.Seconds()),
		})
		if ferr != nil {
			return fmt.Errorf("record pin failure: %w", ferr)
		}
		if justLocked {
			d.notifyOwners(ctx, user, domain.NotificationCaregiverPINLocked, pgtype.UUID{}, map[string]string{
				"caregiver_id":   user.ID.String(),
				"caregiver_name": caregiverDisplayName(user),
			})
		}
		return ErrPINIncorrect{}
	}

	if err := d.Queries.ClearPINFailures(ctx, user.ID); err != nil {
		return fmt.Errorf("clear pin failures: %w", err)
	}
	return nil
}

// VerifyPINLogin authenticates a phone-or-username + PIN from any device.
//
// deviceToken is the caller's device cookie (may be empty). A device not
// known for this user is enrolled and the owners are told (spec §5.3); the
// new token comes back in the result.
func (d PINAuthDeps) VerifyPINLogin(ctx context.Context, identifier, pin, deviceToken, deviceLabel string) (PINLoginResult, error) {
	user, found, err := d.lookupCaregiver(ctx, identifier)
	if err != nil {
		return PINLoginResult{}, err
	}
	if !found {
		// Unknown account costs the same argon2id work as a wrong PIN, so
		// the two cannot be told apart by timing either.
		auth.BurnPasswordCheck(pin)
		return PINLoginResult{}, ErrPINIncorrect{}
	}

	if err := d.checkPIN(ctx, user, pin); err != nil {
		return PINLoginResult{}, err
	}

	if deviceToken != "" {
		dev, derr := d.Queries.GetTrustedDeviceByHash(ctx, hashToken(deviceToken))
		if derr == nil && dev.UserID == user.ID {
			_ = d.Queries.TouchTrustedDevice(ctx, dev.ID)
			return PINLoginResult{User: user}, nil
		}
		if derr != nil && !errors.Is(derr, pgx.ErrNoRows) {
			return PINLoginResult{}, fmt.Errorf("lookup device: %w", derr)
		}
	}

	deviceID, raw, err := d.enrolDevice(ctx, user.ID, deviceLabel)
	if err != nil {
		return PINLoginResult{}, err
	}
	d.notifyOwners(ctx, user, domain.NotificationCaregiverNewDevice, pgtype.UUID{Bytes: deviceID, Valid: true}, map[string]string{
		"caregiver_id":   user.ID.String(),
		"caregiver_name": caregiverDisplayName(user),
		"device":         DeviceSummary(deviceLabel),
		"signed_in_at":   time.Now().UTC().Format(time.RFC3339),
	})
	return PINLoginResult{User: user, DeviceToken: raw}, nil
}

// VerifyCurrentPIN re-checks a signed-in user's PIN before a PIN change.
// Failures count toward the same lockout as login.
func (d PINAuthDeps) VerifyCurrentPIN(ctx context.Context, userID uuid.UUID, pin string) error {
	user, err := d.Queries.GetUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("get user: %w", err)
	}
	return d.checkPIN(ctx, user, pin)
}

// UnlockPIN is the owner's "Buka kunci" (spec §6): it clears a caregiver's
// lock and backoff level so a malicious lockout cannot keep them out of
// their shift.
func (d PINAuthDeps) UnlockPIN(ctx context.Context, workspaceID, actorID uuid.UUID, actorRole string, targetID uuid.UUID) error {
	if domain.Role(actorRole) != domain.RoleOwner {
		return ErrMemberNotOwner{}
	}
	if _, err := d.Queries.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID,
		UserID:      targetID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFoundTyped{Resource: "member"}
		}
		return fmt.Errorf("get workspace member: %w", err)
	}
	if err := d.Queries.ClearPINFailures(ctx, targetID); err != nil {
		return fmt.Errorf("unlock pin: %w", err)
	}
	// No audit_logs table yet: log the event with IDs only (no PII).
	slog.InfoContext(ctx, "member.pin_unlocked",
		"workspace_id", workspaceID, "actor_id", actorID, "target_id", targetID)
	return nil
}

// notifyOwners writes an in-app notification for every owner of every
// workspace the caregiver belongs to. Best effort: a failed alert must not
// fail the sign-in that triggered it, so errors are logged, not returned.
func (d PINAuthDeps) notifyOwners(ctx context.Context, caregiver store.User, kind domain.NotificationType, subject pgtype.UUID, payload map[string]string) {
	body, err := json.Marshal(payload)
	if err != nil {
		slog.WarnContext(ctx, "notify owners: marshal payload", "type", kind, "error", err)
		return
	}
	owners, err := d.Queries.ListOwnersForMemberWorkspaces(ctx, caregiver.ID)
	if err != nil {
		slog.WarnContext(ctx, "notify owners: list owners", "type", kind, "user_id", caregiver.ID, "error", err)
		return
	}
	for _, o := range owners {
		if _, err := d.Queries.CreateNotification(ctx, store.CreateNotificationParams{
			WorkspaceID: o.WorkspaceID,
			UserID:      o.OwnerID,
			Type:        kind.String(),
			SubjectID:   subject,
			Payload:     body,
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.WarnContext(ctx, "notify owners: create notification",
				"type", kind, "workspace_id", o.WorkspaceID, "error", err)
		}
	}
}

// caregiverDisplayName is how an owner recognises the caregiver in an alert.
func caregiverDisplayName(u store.User) string {
	switch {
	case u.FullName.Valid && strings.TrimSpace(u.FullName.String) != "":
		return u.FullName.String
	case u.Username.Valid:
		return u.Username.String
	default:
		return u.Phone.String
	}
}

// DeviceSummary turns a User-Agent into "Chrome · Android", the form an
// owner can recognise in a new-device alert. Unknown parts are left out.
func DeviceSummary(ua string) string {
	browser := ""
	switch {
	case strings.Contains(ua, "SamsungBrowser"):
		browser = "Samsung Internet"
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/"), strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"), strings.Contains(ua, "FxiOS"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/"), strings.Contains(ua, "CriOS"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	os := ""
	switch {
	case strings.Contains(ua, "Android"):
		os = "Android"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		os = "iOS"
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case strings.Contains(ua, "Mac OS X"):
		os = "macOS"
	case strings.Contains(ua, "Linux"):
		os = "Linux"
	}
	switch {
	case browser != "" && os != "":
		return browser + " · " + os
	case browser != "":
		return browser
	default:
		return os
	}
}

// RequestPINReset records a caregiver's forgot-PIN request for owner
// approval, binding it to the device that asked.
//
// The request itself grants nothing: it only surfaces a prompt to the owner.
func (d PINAuthDeps) RequestPINReset(ctx context.Context, identifier, deviceLabel, ip string) error {
	user, found, err := d.lookupCaregiver(ctx, identifier)
	if err != nil || !found {
		// Silent success: confirming which accounts exist would turn this
		// endpoint into a user-enumeration oracle.
		return nil //nolint:nilerr // deliberate: never reveal whether the account exists
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
	user, err := d.Queries.GetUser(ctx, req.UserID)
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("get user: %w", err)
	}
	hash, err := hashPINFor(newPIN, user.Phone.String)
	if err != nil {
		return uuid.Nil, "", err
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
