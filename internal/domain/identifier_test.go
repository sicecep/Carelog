package domain

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseOwnerIdentifier(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		wantKind IdentifierKind
		wantNorm string
	}{
		{name: "email", raw: "dewi@carelog.test", wantKind: IdentifierEmail, wantNorm: "dewi@carelog.test"},
		{name: "email lowercased and trimmed", raw: "  Dewi@CareLog.Test ", wantKind: IdentifierEmail, wantNorm: "dewi@carelog.test"},
		{name: "local phone", raw: "0812-3456-789", wantKind: IdentifierPhone, wantNorm: "+628123456789"},
		{name: "e164 phone", raw: "+628123456789", wantKind: IdentifierPhone, wantNorm: "+628123456789"},
		{name: "empty", raw: "   ", wantKind: IdentifierUnknown},
		{name: "username is not an owner identifier", raw: "sari.pengasuh", wantKind: IdentifierUnknown},
		{name: "at sign only", raw: "@", wantKind: IdentifierUnknown},
		{name: "missing domain", raw: "dewi@", wantKind: IdentifierUnknown},
		{name: "missing name", raw: "@carelog.test", wantKind: IdentifierUnknown},
		{name: "space inside email", raw: "de wi@carelog.test", wantKind: IdentifierUnknown},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kind, norm := ParseOwnerIdentifier(tt.raw)
			require.Equal(t, tt.wantKind, kind)
			require.Equal(t, tt.wantNorm, norm)
		})
	}
}
