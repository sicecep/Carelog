package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

func TestSeverityIsUrgent(t *testing.T) {
	tests := []struct {
		severity domain.Severity
		want     bool
	}{
		{domain.SeverityLow, false},
		{domain.SeverityMedium, false},
		{domain.SeverityHigh, true},
		{domain.SeverityEmergency, true},
		// Unknown severity fails loud: better to over-notify a parent than
		// to silently swallow a serious incident because of bad data.
		{domain.Severity("bogus"), true},
		{domain.Severity(""), true},
	}
	for _, tt := range tests {
		t.Run(string(tt.severity), func(t *testing.T) {
			require.Equal(t, tt.want, tt.severity.IsUrgent())
		})
	}
}
