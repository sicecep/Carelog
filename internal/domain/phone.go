package domain

import (
	"errors"
	"strings"
)

// Indonesian phone numbers are written half a dozen ways in practice —
// 0812…, 62812…, +62 812-3456-7890, (0812) 3456 7890. Every one of those is
// the same human. Storing them verbatim would let one caregiver end up with
// several accounts (and a PIN that "doesn't work" because they enrolled
// against a different row), so all input funnels through Normalize before it
// touches the database.

// DefaultCountryCode is the country whose national format ("08…") is assumed
// when the caller supplies no international prefix. CareLog's market is
// Indonesia; a number from elsewhere must be typed with its + prefix.
const DefaultCountryCode = "62"

var (
	// ErrPhoneEmpty is returned for a blank input.
	ErrPhoneEmpty = errors.New("phone: empty")
	// ErrPhoneInvalid is returned when the input cannot be a phone number.
	ErrPhoneInvalid = errors.New("phone: invalid")
)

// NormalizePhone converts a user-typed Indonesian (or international) number
// into canonical E.164: "+" followed by digits, no spaces or punctuation.
//
// Accepted shapes, all yielding +628123456789:
//
//	0812-3456-789      national, leading zero
//	62812 3456 789     country code, no plus
//	+62 812 3456 789   already international
//	(0812) 3456789     punctuation
func NormalizePhone(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", ErrPhoneEmpty
	}

	// Keep digits; remember whether the user typed a leading '+' so
	// "+1..." is not mistaken for an Indonesian national number.
	hadPlus := strings.HasPrefix(trimmed, "+")
	var digits strings.Builder
	for _, r := range trimmed {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
			continue
		}
		// Formatting characters are fine anywhere; anything else (letters,
		// an interior '+') means this is not a phone number.
		switch r {
		case ' ', '-', '(', ')', '.', '\t', '\u00a0':
		case '+':
			if digits.Len() > 0 {
				return "", ErrPhoneInvalid
			}
		default:
			return "", ErrPhoneInvalid
		}
	}

	d := digits.String()
	if d == "" {
		return "", ErrPhoneInvalid
	}

	switch {
	case hadPlus:
		// Already international; trust the typed country code.
	case strings.HasPrefix(d, "0"):
		// National format: drop the trunk prefix, prepend the country code.
		d = DefaultCountryCode + strings.TrimLeft(d, "0")
	case strings.HasPrefix(d, DefaultCountryCode):
		// Country code without the plus.
	default:
		// A bare subscriber number ("812…") — assume the default country.
		d = DefaultCountryCode + d
	}

	// E.164: max 15 digits, and a country code never starts with 0.
	if len(d) < 7 || len(d) > 15 || d[0] == '0' {
		return "", ErrPhoneInvalid
	}
	return "+" + d, nil
}

// MaskPhone renders a number for display without exposing it in full, e.g.
// "+6281234567890" → "+62812****7890". Used in logs and in UI that confirms
// which number an action targeted.
func MaskPhone(e164 string) string {
	if len(e164) < 8 {
		return e164
	}
	keepFront := 6
	keepBack := 4
	if len(e164) <= keepFront+keepBack {
		return e164
	}
	return e164[:keepFront] + strings.Repeat("*", 4) + e164[len(e164)-keepBack:]
}
