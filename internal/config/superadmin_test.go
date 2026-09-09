package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseEmailList(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{"empty is nil", "", nil},
		{"whitespace only is nil", "   ", nil},
		{"commas only is nil", ",,,", nil},
		{"single email", "admin@example.com", []string{"admin@example.com"}},
		{
			"multiple emails",
			"a@x.com,b@y.com",
			[]string{"a@x.com", "b@y.com"},
		},
		{
			"trims surrounding whitespace",
			" a@x.com , b@y.com ",
			[]string{"a@x.com", "b@y.com"},
		},
		{
			"lowercases for the LOWER(email) index",
			"Admin@Example.COM",
			[]string{"admin@example.com"},
		},
		{
			"drops blanks from a trailing comma",
			"a@x.com,",
			[]string{"a@x.com"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, parseEmailList(tt.raw))
		})
	}
}

func TestIsSuperAdminEmail(t *testing.T) {
	c := &Config{SuperAdminEmails: parseEmailList("owner@carelog.app, ops@carelog.app")}

	tests := []struct {
		name  string
		email string
		want  bool
	}{
		{"exact match", "owner@carelog.app", true},
		{"second entry", "ops@carelog.app", true},
		{"case-insensitive", "Owner@CareLog.App", true},
		{"surrounding whitespace tolerated", "  owner@carelog.app  ", true},
		{"non-admin", "someone@else.com", false},
		{"empty string is never an admin", "", false},
		// Guards against a substring bug: a prefix must not match.
		{"prefix is not a match", "owner@carelog.ap", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, c.IsSuperAdminEmail(tt.email))
		})
	}
}

// A deployment that never sets SUPER_ADMIN_EMAILS must have no super-admins at
// all — an empty allow-list must never degrade into "everyone is an admin".
func TestIsSuperAdminEmailEmptyAllowList(t *testing.T) {
	c := &Config{SuperAdminEmails: nil}
	require.False(t, c.IsSuperAdminEmail("anyone@example.com"))
	require.False(t, c.IsSuperAdminEmail(""))
}
