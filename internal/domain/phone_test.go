package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

// The whole point of normalization is that every way a caregiver might type
// their own number collapses to ONE canonical string — otherwise the same
// person enrols twice and their PIN "stops working".
func TestNormalizePhone_IndonesianVariantsCollapse(t *testing.T) {
	want := "+628123456789"
	variants := []string{
		"08123456789",
		"0812-3456-789",
		"0812 3456 789",
		"(0812) 3456789",
		"628123456789",
		"+628123456789",
		"+62 812 3456 789",
		"+62-812-3456-789",
		"  08123456789  ",
		"8123456789",
	}
	for _, in := range variants {
		got, err := domain.NormalizePhone(in)
		require.NoError(t, err, "input %q", in)
		require.Equal(t, want, got, "input %q must normalize to the canonical form", in)
	}
}

func TestNormalizePhone_PreservesForeignCountryCode(t *testing.T) {
	// A '+' means the user told us the country; we must not re-tag it as
	// Indonesian.
	got, err := domain.NormalizePhone("+14155550123")
	require.NoError(t, err)
	require.Equal(t, "+14155550123", got)
}

func TestNormalizePhone_StripsMultipleLeadingZeros(t *testing.T) {
	got, err := domain.NormalizePhone("008123456789")
	require.NoError(t, err)
	require.Equal(t, "+628123456789", got)
}

func TestNormalizePhone_Rejects(t *testing.T) {
	cases := map[string]string{
		"empty":            "",
		"whitespace only":  "   ",
		"letters":          "0812abcd789",
		"interior plus":    "0812+3456",
		"too short":        "0812",
		"too long":         "+6281234567890123456",
		"punctuation only": "()- ",
		"sql-ish":          "0812'; DROP TABLE users;--",
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := domain.NormalizePhone(in)
			require.Error(t, err, "input %q must be rejected", in)
		})
	}
}

// Normalization must be idempotent: re-running it on stored data (a
// migration, a re-save) must not corrupt the value.
func TestNormalizePhone_Idempotent(t *testing.T) {
	once, err := domain.NormalizePhone("0812-3456-789")
	require.NoError(t, err)
	twice, err := domain.NormalizePhone(once)
	require.NoError(t, err)
	require.Equal(t, once, twice)
}

// Output must satisfy the users_phone_e164 CHECK constraint, or inserts fail
// at runtime instead of here.
func TestNormalizePhone_MatchesDatabaseConstraint(t *testing.T) {
	// ^\+[1-9][0-9]{6,14}$
	got, err := domain.NormalizePhone("08123456789")
	require.NoError(t, err)
	require.Regexp(t, `^\+[1-9][0-9]{6,14}$`, got)
}

func TestMaskPhone(t *testing.T) {
	require.Equal(t, "+62812****6789", domain.MaskPhone("+628123456789"))
	// Too short to mask meaningfully — returned as-is rather than crashing.
	require.Equal(t, "+628", domain.MaskPhone("+628"))
}
