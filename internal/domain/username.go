package domain

import (
	"errors"
	"regexp"
	"strings"
)

// Caregiver usernames (login revamp D3, spec §5.1).
//
// The rules mirror the users_username_format CHECK constraint so a value that
// passes here never trips the database, and the database stays the backstop.

const (
	// UsernameMinLen and UsernameMaxLen bound a username's length.
	UsernameMinLen = 3
	UsernameMaxLen = 30
)

var (
	// ErrUsernameInvalid means the username breaks the format rules.
	ErrUsernameInvalid = errors.New("domain: username format is invalid")
	// ErrUsernameReserved means the username is on the reserved list.
	ErrUsernameReserved = errors.New("domain: username is reserved")

	// usernamePattern: starts and ends with a letter or digit, only
	// [a-z0-9._] in between. Same expression as the CHECK constraint.
	usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$`)
	usernameLetter  = regexp.MustCompile(`[a-z]`)
)

// reservedUsernames would let someone pass as staff or the system.
var reservedUsernames = map[string]struct{}{
	"admin": {}, "administrator": {}, "carelog": {}, "support": {},
	"owner": {}, "root": {}, "system": {}, "help": {}, "official": {},
	"staff": {}, "moderator": {}, "security": {}, "api": {}, "www": {},
}

// NormalizeUsername trims and lowercases a typed username and checks it
// against the format rules and the reserved list. It returns the stored form.
func NormalizeUsername(raw string) (string, error) {
	u := strings.ToLower(strings.TrimSpace(raw))
	if len(u) < UsernameMinLen || len(u) > UsernameMaxLen {
		return "", ErrUsernameInvalid
	}
	if !usernamePattern.MatchString(u) || !usernameLetter.MatchString(u) {
		return "", ErrUsernameInvalid
	}
	if _, reserved := reservedUsernames[u]; reserved {
		return "", ErrUsernameReserved
	}
	return u, nil
}

// ParseCaregiverIdentifier interprets the single "Nomor HP atau nama
// pengguna" login field (spec §5.1): a value NormalizePhone accepts is a
// phone, otherwise it is looked up as a username. A username always contains
// a letter, so the two can never be confused. Reserved names are still
// returned as usernames: login only looks them up, and none can exist.
func ParseCaregiverIdentifier(raw string) (IdentifierKind, string) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return IdentifierUnknown, ""
	}
	if phone, err := NormalizePhone(s); err == nil {
		return IdentifierPhone, phone
	}
	u := strings.ToLower(s)
	if usernamePattern.MatchString(u) && usernameLetter.MatchString(u) {
		return IdentifierUsername, u
	}
	return IdentifierUnknown, ""
}
