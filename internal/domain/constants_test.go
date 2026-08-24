package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

// TestValidators drives each enum's validator through a shared table so a new
// enum can't slip in without a matching test.
func TestValidators(t *testing.T) {
	cases := []struct {
		name    string
		check   func(string) bool
		valid   []string
		invalid []string
	}{
		{"Role", domain.IsValidRole,
			[]string{"owner", "caregiver", "viewer"},
			[]string{"", "OWNER", "admin", " owner"}},
		{"CareType", domain.IsValidCareType,
			[]string{"child", "infant", "elderly", "patient"},
			[]string{"", "adult", "Child"}},
		{"LogCategory", domain.IsValidLogCategory,
			[]string{"meal", "sleep", "diaper", "medication", "activity", "mood", "health", "learning", "therapy", "note", "other"},
			[]string{"", "snack", "Meal"}},
		{"IncidentType", domain.IsValidIncidentType,
			[]string{"fall", "injury", "medical", "behavioral", "environmental", "other"},
			[]string{"", "fire"}},
		{"Severity", domain.IsValidSeverity,
			[]string{"low", "medium", "high", "emergency"},
			[]string{"", "critical", "LOW"}},
		{"ReportStatus", domain.IsValidReportStatus,
			[]string{"draft", "submitted", "acknowledged"},
			[]string{"", "closed", "Draft"}},
		{"ContributorRole", domain.IsValidContributorRole,
			[]string{"caregiver", "owner"},
			[]string{"viewer", ""}}, // viewer is a Role but not a ContributorRole
		{"ReportType", domain.IsValidReportType,
			[]string{"detailed", "summary"},
			[]string{"", "brief"}},
		{"Plan", domain.IsValidPlan,
			[]string{"free", "starter", "pro"},
			[]string{"", "enterprise"}},
		{"Locale", domain.IsValidLocale,
			[]string{"id", "en"},
			[]string{"", "jv", "ID"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, v := range tc.valid {
				require.Truef(t, tc.check(v), "%q should be a valid %s", v, tc.name)
			}
			for _, v := range tc.invalid {
				require.Falsef(t, tc.check(v), "%q should not be a valid %s", v, tc.name)
			}
		})
	}
}

// TestSeverityRank pins the ordering used by callers that compare urgency.
func TestSeverityRank(t *testing.T) {
	require.Less(t, domain.SeverityLow.Rank(), domain.SeverityEmergency.Rank())
	require.Equal(t, 0, domain.SeverityLow.Rank())
	require.Equal(t, 3, domain.SeverityEmergency.Rank())
	require.Equal(t, -1, domain.Severity("nope").Rank())
}

// TestPlanLimits mirrors the seeded plan_configs rows. If a limit changes in the
// migration, this test forces the developer to change the domain constants too.
func TestPlanLimits(t *testing.T) {
	free, ok := domain.LimitsFor(domain.PlanFree)
	require.True(t, ok)
	require.Equal(t, 2, *free.MaxRecipients)
	require.Equal(t, 3, *free.MaxCaregivers)
	require.Equal(t, 7, *free.HistoryDays)
	require.Equal(t, 500, *free.StorageMB)
	require.Equal(t, 1, free.MaxBackfillDay)

	pro, ok := domain.LimitsFor(domain.PlanPro)
	require.True(t, ok)
	require.Nil(t, pro.MaxRecipients, "pro plan should be unlimited")
	require.Nil(t, pro.MaxCaregivers, "pro plan should be unlimited")
	require.Nil(t, pro.HistoryDays, "pro plan should be unlimited")
	require.Equal(t, 20480, *pro.StorageMB)

	_, ok = domain.LimitsFor(domain.Plan("mystery"))
	require.False(t, ok)
}

func TestDefaultLocaleIsIndonesian(t *testing.T) {
	require.Equal(t, domain.LocaleID, domain.DefaultLocale)
}
