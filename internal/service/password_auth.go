package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/auth"
	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// Owner email/phone + password authentication (login revamp D1/D2).
// Design: docs/superpowers/specs/2026-11-22-login-revamp-design.md §4, §6.

const (
	// PasswordMaxAttempts failures in a row lock the account.
	PasswordMaxAttempts = 5
	// PasswordLockBase is the first lock; each consecutive lock doubles it.
	PasswordLockBase = 15 * time.Minute
	// PasswordLockCap bounds the doubling (D7).
	PasswordLockCap = 24 * time.Hour
	// fullNameMaxLength matches what the onboarding/profile forms accept.
	fullNameMaxLength = 100
)

// ErrInvalidCredentials covers an unknown account, an account with no
// password, and a wrong password alike — the caller must not learn which.
type ErrInvalidCredentials struct{}

func (ErrInvalidCredentials) Error() string { return "invalid credentials" }
func (ErrInvalidCredentials) Code() string  { return "invalid_credentials" }
func (ErrInvalidCredentials) Message() string {
	return "email/phone or password is incorrect"
}
func (ErrInvalidCredentials) Status() int { return http.StatusUnauthorized }

// ErrAccountLocked means too many failed attempts; the lock lifts by itself
// (doubling backoff, capped at 24 h) or when an admin resets the password.
type ErrAccountLocked struct{}

func (ErrAccountLocked) Error() string { return "account locked" }
func (ErrAccountLocked) Code() string  { return "account_locked" }
func (ErrAccountLocked) Message() string {
	return "too many failed attempts — try again later or contact the CareLog admin"
}
func (ErrAccountLocked) Status() int { return http.StatusTooManyRequests }

// ErrPasswordRejected is a password that fails the length or blocklist rule.
type ErrPasswordRejected struct{ Common bool }

func (e ErrPasswordRejected) Error() string { return "password rejected" }
func (e ErrPasswordRejected) Code() string {
	if e.Common {
		return "password_too_common"
	}
	return "password_invalid"
}
func (e ErrPasswordRejected) Message() string {
	if e.Common {
		return "this password is too easy to guess — choose another"
	}
	return fmt.Sprintf("password must be %d–%d characters", auth.PasswordMinLength, auth.PasswordMaxLength)
}
func (e ErrPasswordRejected) Status() int { return http.StatusBadRequest }

// ErrResetNotAllowed means the admin-reset target is not an owner account
// (a caregiver signs in with a PIN) or is a super-admin.
type ErrResetNotAllowed struct{}

func (ErrResetNotAllowed) Error() string { return "password reset not allowed for this account" }
func (ErrResetNotAllowed) Code() string  { return "reset_not_allowed" }
func (ErrResetNotAllowed) Message() string {
	return "only owner accounts can have their password reset here"
}
func (ErrResetNotAllowed) Status() int { return http.StatusBadRequest }

func passwordRuleError(err error) error {
	switch {
	case errors.Is(err, auth.ErrPasswordCommon):
		return ErrPasswordRejected{Common: true}
	case errors.Is(err, auth.ErrPasswordLength):
		return ErrPasswordRejected{}
	default:
		return err
	}
}

// PasswordAuthDeps carries what the password flows need. Tx runs fn inside
// one database transaction; signup uses it so a user row never exists
// without its password.
type PasswordAuthDeps struct {
	Queries store.Querier
	Tx      func(ctx context.Context, fn func(q store.Querier) error) error
	// Now is injectable for tests; defaults to time.Now.
	Now func() time.Time
}

func (d PasswordAuthDeps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// RegisterOwnerInput is an owner's self-registration (spec §4.1).
type RegisterOwnerInput struct {
	FullName string
	Email    string // optional if Phone is set
	Phone    string // optional if Email is set; any format NormalizePhone accepts
	Password string
	Locale   string
}

// RegisterOwner creates a pending owner with a password. created is false
// when the email or phone is already taken; the caller must respond exactly
// as for a new account so the endpoint cannot be used to discover accounts.
func (d PasswordAuthDeps) RegisterOwner(ctx context.Context, in RegisterOwnerInput) (created bool, err error) {
	name := strings.TrimSpace(in.FullName)
	var verrs []RecipientError
	if name == "" || utf8.RuneCountInString(name) > fullNameMaxLength {
		verrs = append(verrs, RecipientError{Field: "full_name", Message: "full name is required (max 100 characters)"})
	}

	var email, phone pgtype.Text
	if s := strings.TrimSpace(in.Email); s != "" {
		kind, norm := domain.ParseOwnerIdentifier(s)
		if kind != domain.IdentifierEmail {
			verrs = append(verrs, RecipientError{Field: "email", Message: "email is not valid"})
		} else {
			email = pgtype.Text{String: norm, Valid: true}
		}
	}
	if s := strings.TrimSpace(in.Phone); s != "" {
		norm, perr := domain.NormalizePhone(s)
		if perr != nil {
			verrs = append(verrs, RecipientError{Field: "phone", Message: "phone number is not valid"})
		} else {
			phone = pgtype.Text{String: norm, Valid: true}
		}
	}
	if strings.TrimSpace(in.Email) == "" && strings.TrimSpace(in.Phone) == "" {
		verrs = append(verrs, RecipientError{Field: "email", Message: "email or phone number is required"})
	}
	if len(verrs) > 0 {
		return false, ErrValidation{Errors: verrs}
	}

	// Hash before touching the database: the expensive step runs whether or
	// not the identity is free, so timing does not reveal existing accounts.
	hash, err := auth.HashPassword(in.Password, email.String, phone.String)
	if err != nil {
		return false, passwordRuleError(err)
	}

	locale := in.Locale
	if locale != "en" {
		locale = "id"
	}

	err = d.Tx(ctx, func(q store.Querier) error {
		user, cerr := q.CreateOwnerUser(ctx, store.CreateOwnerUserParams{
			Email:    email,
			Phone:    phone,
			FullName: pgtype.Text{String: name, Valid: true},
			Locale:   locale,
		})
		if errors.Is(cerr, pgx.ErrNoRows) {
			return nil // identity taken; created stays false
		}
		if cerr != nil {
			return fmt.Errorf("create owner user: %w", cerr)
		}
		if _, perr := q.UpsertUserPassword(ctx, store.UpsertUserPasswordParams{
			UserID:       user.ID,
			PasswordHash: hash,
			MustChange:   false,
		}); perr != nil {
			return fmt.Errorf("store password: %w", perr)
		}
		created = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return created, nil
}

// VerifyPasswordLogin authenticates an owner by email or phone + password
// (spec §4.2). mustChange reports an admin-issued temporary password.
func (d PasswordAuthDeps) VerifyPasswordLogin(ctx context.Context, identifier, password string) (user store.User, mustChange bool, err error) {
	kind, norm := domain.ParseOwnerIdentifier(identifier)

	var lookupErr error
	switch kind {
	case domain.IdentifierEmail:
		user, lookupErr = d.Queries.GetUserByEmail(ctx, norm)
	case domain.IdentifierPhone:
		user, lookupErr = d.Queries.GetUserByPhone(ctx, pgtype.Text{String: norm, Valid: true})
	default:
		lookupErr = pgx.ErrNoRows
	}
	if lookupErr != nil {
		if errors.Is(lookupErr, pgx.ErrNoRows) {
			auth.BurnPasswordCheck(password)
			return store.User{}, false, ErrInvalidCredentials{}
		}
		return store.User{}, false, fmt.Errorf("lookup user: %w", lookupErr)
	}

	rec, err := d.Queries.GetUserPassword(ctx, user.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The account exists but signs in another way (PIN, legacy magic
			// link). Indistinguishable from a wrong password.
			auth.BurnPasswordCheck(password)
			return store.User{}, false, ErrInvalidCredentials{}
		}
		return store.User{}, false, fmt.Errorf("lookup password: %w", err)
	}

	if rec.LockedUntil.Valid && rec.LockedUntil.Time.After(d.now()) {
		return store.User{}, false, ErrAccountLocked{}
	}

	ok, err := auth.VerifyPassword(password, rec.PasswordHash)
	if err != nil {
		// A malformed stored hash must fail closed, loudly.
		return store.User{}, false, fmt.Errorf("verify password: %w", err)
	}
	if !ok {
		if _, ferr := d.Queries.RecordPasswordFailure(ctx, store.RecordPasswordFailureParams{
			UserID:      user.ID,
			MaxAttempts: PasswordMaxAttempts,
			BaseSeconds: int64(PasswordLockBase.Seconds()),
			CapSeconds:  int64(PasswordLockCap.Seconds()),
		}); ferr != nil {
			return store.User{}, false, fmt.Errorf("record password failure: %w", ferr)
		}
		return store.User{}, false, ErrInvalidCredentials{}
	}

	if err := d.Queries.ClearPasswordFailures(ctx, user.ID); err != nil {
		return store.User{}, false, fmt.Errorf("clear password failures: %w", err)
	}
	return user, rec.MustChange, nil
}

// ChangePassword sets a new password for a signed-in user and signs out
// every other session (spec §4.3). currentPassword is required when the
// account already has a password; an owner who signed up by magic link
// before this change has none and sets their first one here.
func (d PasswordAuthDeps) ChangePassword(ctx context.Context, userID, keepFamilyID uuid.UUID, currentPassword, newPassword string) error {
	user, err := d.Queries.GetUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("load user: %w", err)
	}

	rec, err := d.Queries.GetUserPassword(ctx, userID)
	hasPassword := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("lookup password: %w", err)
	}

	if hasPassword {
		if rec.LockedUntil.Valid && rec.LockedUntil.Time.After(d.now()) {
			return ErrAccountLocked{}
		}
		ok, verr := auth.VerifyPassword(currentPassword, rec.PasswordHash)
		if verr != nil {
			return fmt.Errorf("verify current password: %w", verr)
		}
		if !ok {
			// A stolen session must not be able to brute-force the password.
			if _, ferr := d.Queries.RecordPasswordFailure(ctx, store.RecordPasswordFailureParams{
				UserID:      userID,
				MaxAttempts: PasswordMaxAttempts,
				BaseSeconds: int64(PasswordLockBase.Seconds()),
				CapSeconds:  int64(PasswordLockCap.Seconds()),
			}); ferr != nil {
				return fmt.Errorf("record password failure: %w", ferr)
			}
			return ErrInvalidCredentials{}
		}
		if newPassword == currentPassword {
			return ErrValidation{Errors: []RecipientError{{Field: "password", Message: "choose a password different from the current one"}}}
		}
	}

	hash, err := auth.HashPassword(newPassword, user.Email.String, user.Phone.String)
	if err != nil {
		return passwordRuleError(err)
	}
	if _, err := d.Queries.UpsertUserPassword(ctx, store.UpsertUserPasswordParams{
		UserID:       userID,
		PasswordHash: hash,
		MustChange:   false,
	}); err != nil {
		return fmt.Errorf("store password: %w", err)
	}
	if err := d.Queries.RevokeOtherUserRefreshFamilies(ctx, store.RevokeOtherUserRefreshFamiliesParams{
		UserID:       userID,
		KeepFamilyID: keepFamilyID,
	}); err != nil {
		return fmt.Errorf("revoke other sessions: %w", err)
	}
	return nil
}

// AdminResetPassword issues a temporary password for an owner (D2, spec
// §4.5). The plaintext is returned once for the admin to send over WhatsApp;
// the owner must change it on next login. Every session is revoked.
func (d PasswordAuthDeps) AdminResetPassword(ctx context.Context, actorID, targetID uuid.UUID) (string, error) {
	target, err := d.Queries.GetUser(ctx, targetID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFoundTyped{Resource: "user"}
		}
		return "", fmt.Errorf("load user: %w", err)
	}
	if target.IsSuperAdmin {
		return "", ErrResetNotAllowed{}
	}

	_, perr := d.Queries.GetUserPassword(ctx, targetID)
	hasPassword := perr == nil
	if perr != nil && !errors.Is(perr, pgx.ErrNoRows) {
		return "", fmt.Errorf("lookup password: %w", perr)
	}
	if !hasPassword {
		// A legacy magic-link owner has no password yet; a caregiver never
		// should. Only the former is eligible.
		isOwner, oerr := d.Queries.IsWorkspaceOwner(ctx, targetID)
		if oerr != nil {
			return "", fmt.Errorf("check owner: %w", oerr)
		}
		if !isOwner {
			return "", ErrResetNotAllowed{}
		}
	}

	temp, err := auth.GenerateTemporaryPassword()
	if err != nil {
		return "", err
	}
	hash, err := auth.HashTemporaryPassword(temp)
	if err != nil {
		return "", err
	}
	if _, err := d.Queries.UpsertUserPassword(ctx, store.UpsertUserPasswordParams{
		UserID:       targetID,
		PasswordHash: hash,
		MustChange:   true,
	}); err != nil {
		return "", fmt.Errorf("store temporary password: %w", err)
	}
	if err := d.Queries.RevokeAllUserRefreshTokens(ctx, targetID); err != nil {
		return "", fmt.Errorf("revoke sessions: %w", err)
	}

	// There is no audit_logs table yet; record the action with IDs only — no
	// email, phone or password in logs.
	slog.Info("password.admin_reset", "actor_id", actorID, "target_id", targetID)
	return temp, nil
}

// PasswordChangeRequired reports whether the user must replace an
// admin-issued temporary password before using the app.
func (d PasswordAuthDeps) PasswordChangeRequired(ctx context.Context, userID uuid.UUID) (bool, error) {
	rec, err := d.Queries.GetUserPassword(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("lookup password: %w", err)
	}
	return rec.MustChange, nil
}
