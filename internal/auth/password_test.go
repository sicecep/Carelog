package auth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name       string
		password   string
		identities []string
		want       error
	}{
		{name: "ok", password: "kopi-susu-pagi", want: nil},
		{name: "exactly min length", password: "Gz8!qPw2", want: nil},
		{name: "too short", password: "Gz8!qPw", want: ErrPasswordLength},
		{name: "too long", password: strings.Repeat("a", PasswordMaxLength+1), want: ErrPasswordLength},
		{name: "max length ok", password: strings.Repeat("x7", PasswordMaxLength/2), want: nil},
		{name: "length counts characters not bytes", password: "ñandú-çé", want: nil},
		{name: "global common", password: "password123", want: ErrPasswordCommon},
		{name: "common is case-insensitive", password: "PassWord123", want: ErrPasswordCommon},
		{name: "indonesian common", password: "bismillah123", want: ErrPasswordCommon},
		{name: "equals email", password: "dewi@carelog.test", identities: []string{"dewi@carelog.test"}, want: ErrPasswordCommon},
		{name: "equals email name part", password: "dewi.anggraini", identities: []string{"dewi.anggraini@carelog.test"}, want: ErrPasswordCommon},
		{name: "equals phone digits", password: "628123456789", identities: []string{"+628123456789"}, want: ErrPasswordCommon},
		{name: "equals local phone format", password: "08123456789", identities: []string{"+628123456789"}, want: ErrPasswordCommon},
		{name: "empty identity ignored", password: "kopi-susu-pagi", identities: []string{"", "  "}, want: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePassword(tt.password, tt.identities...)
			if tt.want == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.want)
		})
	}
}

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("kopi-susu-pagi", "dewi@carelog.test")
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=4$"), hash)

	ok, err := VerifyPassword("kopi-susu-pagi", hash)
	require.NoError(t, err)
	require.True(t, ok)

	ok, err = VerifyPassword("kopi-susu-sore", hash)
	require.NoError(t, err)
	require.False(t, ok)

	// Salted: the same password hashes differently each time.
	hash2, err := HashPassword("kopi-susu-pagi")
	require.NoError(t, err)
	require.NotEqual(t, hash, hash2)
}

func TestHashPassword_EnforcesRules(t *testing.T) {
	_, err := HashPassword("short")
	require.ErrorIs(t, err, ErrPasswordLength)
	_, err = HashPassword("password123")
	require.ErrorIs(t, err, ErrPasswordCommon)
}

func TestVerifyPassword_MalformedHashFailsClosed(t *testing.T) {
	ok, err := VerifyPassword("anything", "not-a-hash")
	require.ErrorIs(t, err, ErrPINHashInvalid)
	require.False(t, ok)
}

func TestGenerateTemporaryPassword(t *testing.T) {
	seen := map[string]bool{}
	for range 200 {
		p, err := GenerateTemporaryPassword()
		require.NoError(t, err)
		require.Len(t, p, TempPasswordLength)
		for _, r := range p {
			require.True(t, strings.ContainsRune(tempPasswordAlphabet, r), "unexpected rune %q", r)
		}
		require.False(t, seen[p], "duplicate temporary password")
		seen[p] = true
	}
	// No look-alike characters an admin could mistype over WhatsApp.
	require.False(t, strings.ContainsAny(tempPasswordAlphabet, "0O1lI"))
}

func TestHashTemporaryPassword_VerifiesAndSkipsBlocklist(t *testing.T) {
	hash, err := HashTemporaryPassword("password123") // random in practice; blocklist not applied
	require.NoError(t, err)
	ok, err := VerifyPassword("password123", hash)
	require.NoError(t, err)
	require.True(t, ok)

	_, err = HashTemporaryPassword("short")
	require.ErrorIs(t, err, ErrPasswordLength)
}

func TestBurnPasswordCheck_DoesNotPanic(t *testing.T) {
	require.NotPanics(t, func() { BurnPasswordCheck("whatever") })
}
