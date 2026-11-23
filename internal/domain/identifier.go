package domain

import "strings"

// IdentifierKind says which account field a typed login identifier refers to.
type IdentifierKind int

const (
	// IdentifierUnknown matches no account field. Login treats it exactly
	// like an unknown account so the response never reveals which it was.
	IdentifierUnknown IdentifierKind = iota
	IdentifierEmail
	IdentifierPhone
	IdentifierUsername
)

// ParseOwnerIdentifier interprets what an owner typed into the single
// "Email atau nomor HP" field (login revamp D1, spec §4.2):
//
//   - anything containing '@' is an email, returned trimmed and lowercased
//     (lookups are case-insensitive anyway; lowercasing keeps logs and
//     comparisons uniform);
//   - otherwise, a value NormalizePhone accepts is a phone, returned as E.164;
//   - anything else is unknown.
func ParseOwnerIdentifier(raw string) (IdentifierKind, string) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return IdentifierUnknown, ""
	}
	if strings.Contains(s, "@") {
		at := strings.LastIndexByte(s, '@')
		if at <= 0 || at == len(s)-1 || strings.ContainsAny(s, " \t") {
			return IdentifierUnknown, ""
		}
		return IdentifierEmail, strings.ToLower(s)
	}
	if phone, err := NormalizePhone(s); err == nil {
		return IdentifierPhone, phone
	}
	return IdentifierUnknown, ""
}
