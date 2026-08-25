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
		{"Module", domain.IsValidModule,
			[]string{"meal", "sleep", "diaper", "medication", "activity", "mood", "health", "learning", "therapy", "note"},
			[]string{"", "other", "Meal", "vitamins"}}, // "other" is a LogCategory but never a Module
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

// TestDefaultModulesForCareType pins the per-care-type defaults. These drive
// both the wizard's pre-checked toggles and the server's subset validation, so a
// change here is a change to what a profile is allowed to enable.
func TestDefaultModulesForCareType(t *testing.T) {
	cases := []struct {
		careType domain.CareType
		want     []domain.Module
	}{
		{domain.CareTypeInfant, []domain.Module{
			domain.ModuleMeal, domain.ModuleSleep, domain.ModuleDiaper,
			domain.ModuleHealth, domain.ModuleMood, domain.ModuleNote,
		}},
		{domain.CareTypeChild, []domain.Module{
			domain.ModuleMeal, domain.ModuleSleep, domain.ModuleActivity,
			domain.ModuleLearning, domain.ModuleMood, domain.ModuleHealth,
			domain.ModuleNote,
		}},
		{domain.CareTypeElderly, []domain.Module{
			domain.ModuleMeal, domain.ModuleMedication, domain.ModuleHealth,
			domain.ModuleMood, domain.ModuleActivity, domain.ModuleNote,
		}},
		{domain.CareTypePatient, []domain.Module{
			domain.ModuleMedication, domain.ModuleHealth, domain.ModuleTherapy,
			domain.ModuleNote, domain.ModuleMeal, domain.ModuleMood,
		}},
	}

	for _, tc := range cases {
		t.Run(tc.careType.String(), func(t *testing.T) {
			got, ok := domain.DefaultModulesForCareType(tc.careType)
			require.True(t, ok)
			require.Equal(t, tc.want, got)

			for _, m := range got {
				require.Truef(t, domain.IsValidModule(m.String()),
					"%q is a default but not a valid Module", m)
			}
		})
	}
}

// TestEveryCareTypeHasDefaultModules stops a new care type from shipping without
// defaults, which would leave the wizard's step 3 empty.
func TestEveryCareTypeHasDefaultModules(t *testing.T) {
	for _, c := range domain.CareTypes {
		mods, ok := domain.DefaultModulesForCareType(c)
		require.Truef(t, ok, "care type %q has no default modules", c)
		require.NotEmptyf(t, mods, "care type %q has an empty default module set", c)
	}

	_, ok := domain.DefaultModulesForCareType(domain.CareType("alien"))
	require.False(t, ok)
}

// TestDefaultModulesAreACopy guards the accessor's defensive copy: a caller that
// mutates the returned slice must not corrupt the shared defaults.
func TestDefaultModulesAreACopy(t *testing.T) {
	first, ok := domain.DefaultModulesForCareType(domain.CareTypeInfant)
	require.True(t, ok)
	first[0] = domain.ModuleTherapy

	second, ok := domain.DefaultModulesForCareType(domain.CareTypeInfant)
	require.True(t, ok)
	require.Equal(t, domain.ModuleMeal, second[0], "defaults were mutated by a caller")
}

func TestDefaultLocaleIsIndonesian(t *testing.T) {
	require.Equal(t, domain.LocaleID, domain.DefaultLocale)
}
