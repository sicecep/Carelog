// Package service tests for the recipient business logic.
package service

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

// fixedNow pins "today" so date-of-birth checks are deterministic.
var fixedNow = time.Date(2026, 11, 23, 3, 0, 0, 0, time.UTC)

func date(y int, m time.Month, d int) *pgtype.Date {
	return &pgtype.Date{Time: time.Date(y, m, d, 0, 0, 0, 0, time.UTC), Valid: true}
}

func ptrTo[T any](v T) *T { return &v }

func errFields(errs []RecipientError) []string {
	var fields []string
	for _, e := range errs {
		fields = append(fields, e.Field)
	}
	return fields
}

func TestValidateCreateRecipientInput(t *testing.T) {
	tests := []struct {
		name       string
		input      CreateRecipientInput
		wantFields []string
	}{
		{
			name:       "empty name fails",
			input:      CreateRecipientInput{CareType: domain.CareTypeChild, EnabledModules: []domain.Module{domain.ModuleMeal}},
			wantFields: []string{"full_name"},
		},
		{
			name:       "invalid care type fails",
			input:      CreateRecipientInput{FullName: "Test", CareType: domain.CareType("alien")},
			wantFields: []string{"care_type"},
		},
		{
			name:       "unknown module fails",
			input:      CreateRecipientInput{FullName: "Test", CareType: domain.CareTypeChild, EnabledModules: []domain.Module{"other"}},
			wantFields: []string{"enabled_modules"},
		},
		{
			name:  "medication for a child passes",
			input: CreateRecipientInput{FullName: "Anak", CareType: domain.CareTypeChild, EnabledModules: []domain.Module{domain.ModuleMedication}},
		},
		{
			name:  "diaper and therapy for elderly pass",
			input: CreateRecipientInput{FullName: "Eyang", CareType: domain.CareTypeElderly, EnabledModules: []domain.Module{domain.ModuleDiaper, domain.ModuleTherapy}},
		},
		{
			name:  "every module for an infant passes",
			input: CreateRecipientInput{FullName: "Bayi", CareType: domain.CareTypeInfant, EnabledModules: domain.Modules},
		},
		{
			name:  "no optional details passes",
			input: CreateRecipientInput{FullName: "Test", CareType: domain.CareTypePatient, EnabledModules: []domain.Module{domain.ModuleHealth}},
		},
		{
			name: "all optional details pass",
			input: CreateRecipientInput{
				FullName: "Test", CareType: domain.CareTypeElderly, EnabledModules: []domain.Module{domain.ModuleMeal},
				Gender: ptrTo("female"), DateOfBirth: date(1950, 3, 14), WeightKg: ptrTo(52.5), HeightCm: ptrTo(150.5),
			},
		},
		{
			name: "bad optional details are each reported",
			input: CreateRecipientInput{
				FullName: "Test", CareType: domain.CareTypeChild,
				Gender: ptrTo("unknown"), DateOfBirth: date(2030, 1, 1), WeightKg: ptrTo(0.0), HeightCm: ptrTo(400.0),
			},
			wantFields: []string{"gender", "date_of_birth", "weight_kg", "height_cm"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.wantFields, errFields(validateCreateRecipientInput(tc.input, fixedNow)))
		})
	}
}

func TestValidateProfileDetails(t *testing.T) {
	tests := []struct {
		name      string
		details   ProfileDetails
		wantField string // "" means valid
	}{
		{name: "all nil is valid", details: ProfileDetails{}},
		{name: "male", details: ProfileDetails{Gender: ptrTo("male")}},
		{name: "female", details: ProfileDetails{Gender: ptrTo("female")}},
		{name: "other", details: ProfileDetails{Gender: ptrTo("other")}},
		{name: "capitalised gender", details: ProfileDetails{Gender: ptrTo("Male")}, wantField: "gender"},
		{name: "empty gender string", details: ProfileDetails{Gender: ptrTo("")}, wantField: "gender"},
		{name: "null date is valid", details: ProfileDetails{DateOfBirth: &pgtype.Date{}}},
		{name: "born today", details: ProfileDetails{DateOfBirth: date(2026, 11, 23)}},
		{name: "born tomorrow in UTC, today in WIT", details: ProfileDetails{DateOfBirth: date(2026, 11, 24)}},
		{name: "born next week", details: ProfileDetails{DateOfBirth: date(2026, 11, 30)}, wantField: "date_of_birth"},
		{name: "born in 1900", details: ProfileDetails{DateOfBirth: date(1900, 1, 1)}},
		{name: "year typo", details: ProfileDetails{DateOfBirth: date(195, 1, 1)}, wantField: "date_of_birth"},
		{name: "weight at min", details: ProfileDetails{WeightKg: ptrTo(0.5)}},
		{name: "weight at max", details: ProfileDetails{WeightKg: ptrTo(300.0)}},
		{name: "weight below min", details: ProfileDetails{WeightKg: ptrTo(0.4)}, wantField: "weight_kg"},
		{name: "weight above max", details: ProfileDetails{WeightKg: ptrTo(300.5)}, wantField: "weight_kg"},
		{name: "negative weight", details: ProfileDetails{WeightKg: ptrTo(-3.0)}, wantField: "weight_kg"},
		{name: "height at min", details: ProfileDetails{HeightCm: ptrTo(20.0)}},
		{name: "height at max", details: ProfileDetails{HeightCm: ptrTo(250.0)}},
		{name: "height below min", details: ProfileDetails{HeightCm: ptrTo(19.9)}, wantField: "height_cm"},
		{name: "height in metres by mistake", details: ProfileDetails{HeightCm: ptrTo(1.6)}, wantField: "height_cm"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errs := ValidateProfileDetails(tc.details, fixedNow)
			if tc.wantField == "" {
				require.Empty(t, errs)
				return
			}
			require.Equal(t, []string{tc.wantField}, errFields(errs))
		})
	}
}

func TestNumericFromFloat(t *testing.T) {
	tests := []struct {
		name string
		in   *float64
		want *float64
	}{
		{name: "nil is NULL", in: nil, want: nil},
		{name: "whole number", in: ptrTo(70.0), want: ptrTo(70.0)},
		{name: "decimal", in: ptrTo(3.25), want: ptrTo(3.25)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			n, err := NumericFromFloat(tc.in)
			require.NoError(t, err)
			if tc.want == nil {
				require.False(t, n.Valid)
				return
			}
			f, err := n.Float64Value()
			require.NoError(t, err)
			require.InDelta(t, *tc.want, f.Float64, 1e-9)
		})
	}
}

func TestEveryCareTypeHasAtLeastOneModule(t *testing.T) {
	for _, ct := range domain.CareTypes {
		mods, ok := domain.DefaultModulesForCareType(ct)
		require.True(t, ok, "care type %q has no defaults", ct)
		require.NotEmpty(t, mods, "care type %q has empty defaults", ct)
	}
}

func TestModuleConstants(t *testing.T) {
	// Every module constant is valid
	for _, m := range domain.Modules {
		require.True(t, domain.IsValidModule(m.String()), "%q should be valid", m)
	}

	// "other" is a LogCategory but NOT a Module
	require.False(t, domain.IsValidModule("other"))

	// Case sensitivity
	require.False(t, domain.IsValidModule("Meal"))
	require.False(t, domain.IsValidModule("MEAL"))
}
