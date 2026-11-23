package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// Caregiver usernames (login revamp §5.1–5.2).

// usernameUniqueIndex is the index behind "one username per app".
const usernameUniqueIndex = "idx_users_username_lower"

// ErrUsernameTaken means another account already uses the username.
type ErrUsernameTaken struct{}

func (ErrUsernameTaken) Error() string   { return "username taken" }
func (ErrUsernameTaken) Code() string    { return "username_taken" }
func (ErrUsernameTaken) Message() string { return "this username is already taken" }
func (ErrUsernameTaken) Status() int     { return http.StatusConflict }

// ErrUsernameInvalid means the username breaks the format rules or is
// reserved. One code for both: the form shows the same hint either way.
type ErrUsernameInvalid struct{}

func (ErrUsernameInvalid) Error() string { return "username invalid" }
func (ErrUsernameInvalid) Code() string  { return "username_invalid" }
func (ErrUsernameInvalid) Message() string {
	return "use 3–30 lowercase letters, digits, '.' or '_', with at least one letter"
}
func (ErrUsernameInvalid) Status() int { return http.StatusBadRequest }

// normalizeUsername maps the domain errors onto the API error.
func normalizeUsername(raw string) (string, error) {
	u, err := domain.NormalizeUsername(raw)
	if err != nil {
		return "", ErrUsernameInvalid{}
	}
	return u, nil
}

// isUsernameConflict reports whether err is the username unique index firing.
func isUsernameConflict(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == usernameUniqueIndex
}

// UsernameAvailable reports whether raw is a valid username no account uses.
// It backs the invite form's live check, so it returns ErrUsernameInvalid
// for a malformed name rather than "taken".
func UsernameAvailable(ctx context.Context, q store.Querier, raw string) (string, bool, error) {
	u, err := normalizeUsername(raw)
	if err != nil {
		return "", false, err
	}
	taken, err := q.IsUsernameTaken(ctx, u)
	if err != nil {
		return "", false, fmt.Errorf("check username: %w", err)
	}
	return u, !taken, nil
}
