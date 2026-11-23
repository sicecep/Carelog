package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

func TestNormalizeUsername(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    string
		wantErr error
	}{
		{name: "simple", raw: "sari", want: "sari"},
		{name: "dots and underscores inside", raw: "sari.pengasuh_2", want: "sari.pengasuh_2"},
		{name: "lowercased and trimmed", raw: "  Sari.Pengasuh ", want: "sari.pengasuh"},
		{name: "minimum length", raw: "abc", want: "abc"},
		{name: "too short", raw: "ab", wantErr: domain.ErrUsernameInvalid},
		{name: "too long", raw: "a234567890123456789012345678901", wantErr: domain.ErrUsernameInvalid},
		{name: "digits only", raw: "081234", wantErr: domain.ErrUsernameInvalid},
		{name: "leading dot", raw: ".sari", wantErr: domain.ErrUsernameInvalid},
		{name: "trailing underscore", raw: "sari_", wantErr: domain.ErrUsernameInvalid},
		{name: "space inside", raw: "sari p", wantErr: domain.ErrUsernameInvalid},
		{name: "other symbol", raw: "sari-p", wantErr: domain.ErrUsernameInvalid},
		{name: "reserved", raw: "Admin", wantErr: domain.ErrUsernameReserved},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := domain.NormalizeUsername(tc.raw)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}
}

func TestParseCaregiverIdentifier(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantKind  domain.IdentifierKind
		wantValue string
	}{
		{name: "local phone", raw: "0812-3456-7890", wantKind: domain.IdentifierPhone, wantValue: "+6281234567890"},
		{name: "international phone", raw: "+62 812 3456 7890", wantKind: domain.IdentifierPhone, wantValue: "+6281234567890"},
		{name: "username", raw: " Sari.Pengasuh ", wantKind: domain.IdentifierUsername, wantValue: "sari.pengasuh"},
		{name: "digits that are not a phone", raw: "12", wantKind: domain.IdentifierUnknown},
		{name: "email is not a caregiver identifier", raw: "sari@example.com", wantKind: domain.IdentifierUnknown},
		{name: "blank", raw: "   ", wantKind: domain.IdentifierUnknown},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			kind, value := domain.ParseCaregiverIdentifier(tc.raw)
			require.Equal(t, tc.wantKind, kind)
			if tc.wantKind != domain.IdentifierUnknown {
				require.Equal(t, tc.wantValue, value)
			}
		})
	}
}
