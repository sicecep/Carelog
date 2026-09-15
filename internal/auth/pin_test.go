package auth_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/auth"
)

func TestHashPIN_VerifiesCorrectPIN(t *testing.T) {
	hash, err := auth.HashPIN("284917")
	require.NoError(t, err)

	ok, err := auth.VerifyPIN("284917", hash)
	require.NoError(t, err)
	require.True(t, ok)
}

func TestVerifyPIN_RejectsWrongPIN(t *testing.T) {
	hash, err := auth.HashPIN("284917")
	require.NoError(t, err)

	for _, wrong := range []string{"284918", "184917", "000000", "", "2849170"} {
		ok, err := auth.VerifyPIN(wrong, hash)
		require.NoError(t, err, "wrong pin must not error, just fail: %q", wrong)
		require.False(t, ok, "pin %q must not verify", wrong)
	}
}

// The same PIN must never produce the same stored hash: a shared salt would
// let an attacker spot every user who picked the same PIN straight from a
// dump, and make one cracked hash reusable.
func TestHashPIN_SaltIsRandomPerHash(t *testing.T) {
	a, err := auth.HashPIN("284917")
	require.NoError(t, err)
	b, err := auth.HashPIN("284917")
	require.NoError(t, err)
	require.NotEqual(t, a, b, "identical PINs must hash differently")

	// Both must still verify.
	for _, h := range []string{a, b} {
		ok, err := auth.VerifyPIN("284917", h)
		require.NoError(t, err)
		require.True(t, ok)
	}
}

// Parameters travel with the hash (PHC format) so they can be raised later
// without invalidating PINs already set.
func TestHashPIN_EncodesParameters(t *testing.T) {
	hash, err := auth.HashPIN("284917")
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=4$"), "got %q", hash)
	require.Len(t, strings.Split(hash, "$"), 6)
}

// A raw PIN must never be recoverable from, or visible in, the stored value.
func TestHashPIN_DoesNotLeakPIN(t *testing.T) {
	hash, err := auth.HashPIN("284917")
	require.NoError(t, err)
	require.NotContains(t, hash, "284917")
}

func TestValidatePIN_RejectsBadShape(t *testing.T) {
	cases := map[string]string{
		"too short":   "12345",
		"too long":    "1234567",
		"empty":       "",
		"letters":     "12a456",
		"spaces":      "12 456",
		"unicode":     "12৪456",
		"punctuation": "123-56",
	}
	for name, pin := range cases {
		t.Run(name, func(t *testing.T) {
			require.ErrorIs(t, auth.ValidatePIN(pin), auth.ErrPINFormat)
		})
	}
}

// These are the first values an attacker tries. With only 10^6 possibilities
// to begin with, allowing them would be handing over the account.
func TestValidatePIN_RejectsWeakPINs(t *testing.T) {
	weak := []string{
		"000000", "111111", "999999", "123456", "654321",
		"234567", "098765", "121212", "112233",
	}
	for _, pin := range weak {
		require.ErrorIs(t, auth.ValidatePIN(pin), auth.ErrPINWeak, "pin %q must be rejected as weak", pin)
	}
}

func TestValidatePIN_AcceptsReasonablePINs(t *testing.T) {
	for _, pin := range []string{"284917", "730264", "905182", "471039"} {
		require.NoError(t, auth.ValidatePIN(pin), "pin %q should be allowed", pin)
	}
}

// HashPIN must enforce the rules itself — a caller that forgets to call
// ValidatePIN first must not be able to store a weak or malformed PIN.
func TestHashPIN_EnforcesValidation(t *testing.T) {
	_, err := auth.HashPIN("123456")
	require.ErrorIs(t, err, auth.ErrPINWeak)

	_, err = auth.HashPIN("abc")
	require.ErrorIs(t, err, auth.ErrPINFormat)
}

// A corrupted or truncated hash column must produce an error, never a
// silent "true" that would authenticate anyone.
func TestVerifyPIN_MalformedHashErrorsNeverAuthenticates(t *testing.T) {
	bad := []string{
		"",
		"not-a-hash",
		"$argon2id$v=19$m=65536,t=3,p=4$onlysalt",
		"$bcrypt$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
		"$argon2id$v=13$m=65536,t=3,p=4$c2FsdA$aGFzaA",
		"$argon2id$v=19$bogus$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=65536,t=3,p=4$!!!$aGFzaA",
		"$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$",
	}
	for _, h := range bad {
		ok, err := auth.VerifyPIN("284917", h)
		require.Error(t, err, "hash %q must error", h)
		require.False(t, ok, "hash %q must never verify", h)
	}
}

func BenchmarkHashPIN(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_, _ = auth.HashPIN("284917")
	}
}
