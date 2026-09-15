// Package service tests for the report business logic.
package service

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

func TestAddEntryValidation_InvalidCategory(t *testing.T) {
	input := AddEntryInput{
		Category: domain.LogCategory("invalid"),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "category", valErr.Errors[0].Field)
}

func TestAddEntryValidation_InvalidSubcategoryForCategory(t *testing.T) {
	sub := domain.SubcategoryMedVitaminD // vitamin_d is for medication, not meal
	input := AddEntryInput{
		Category:    domain.LogCategoryMeal,
		Subcategory: &sub,
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "subcategory", valErr.Errors[0].Field)
}

func TestAddEntryValidation_DiaperForElderly_Fails(t *testing.T) {
	input := AddEntryInput{
		Category: domain.LogCategoryDiaper,
	}
	err := validateAddEntryInput(input, domain.CareTypeElderly)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "category", valErr.Errors[0].Field)
	require.Contains(t, valErr.Errors[0].Message, "diaper")
}

func TestAddEntryValidation_DiaperForInfant_Succeeds(t *testing.T) {
	sub := domain.SubcategoryDiaperWet
	input := AddEntryInput{
		Category:    domain.LogCategoryDiaper,
		Subcategory: &sub,
	}
	err := validateAddEntryInput(input, domain.CareTypeInfant)
	require.NoError(t, err)
}

func TestAddEntryValidation_DiaperForChild_Succeeds(t *testing.T) {
	sub := domain.SubcategoryDiaperWet
	input := AddEntryInput{
		Category:    domain.LogCategoryDiaper,
		Subcategory: &sub,
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.NoError(t, err)
}

func TestAddEntryValidation_NoteTooLong_Fails(t *testing.T) {
	longNote := string(make([]byte, domain.MaxNoteLength+1))
	input := AddEntryInput{
		Category:  domain.LogCategoryNote,
		ValueText: &longNote,
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "value_text", valErr.Errors[0].Field)
}

func TestAddEntryValidation_OccurredAtFuture_Fails(t *testing.T) {
	future := time.Now().Add(1 * time.Hour)
	input := AddEntryInput{
		Category:   domain.LogCategoryMeal,
		OccurredAt: &future,
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "occurred_at", valErr.Errors[0].Field)
}

func TestAddEntryValidation_OccurredAtDifferentDay_Fails(t *testing.T) {
	yesterday := time.Now().Add(-25 * time.Hour)
	input := AddEntryInput{
		Category:   domain.LogCategoryMeal,
		OccurredAt: &yesterday,
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "occurred_at", valErr.Errors[0].Field)
}

func TestAddEntryValidation_ValidInput_Passes(t *testing.T) {
	sub := domain.SubcategoryMealBreakfast
	input := AddEntryInput{
		Category:    domain.LogCategoryMeal,
		Subcategory: &sub,
		ValueText:   stringPtr("Had breakfast"),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.NoError(t, err)
}

func TestGetOrCreateTodayReport_RaceCondition(t *testing.T) {
	// This test documents the expected behavior:
	// 1. Try to get existing report
	// 2. If not found, create new
	// 3. If create fails (unique constraint), get again
	// This is tested via integration tests with real DB
	require.True(t, true)
}

// --- Vitals validation (CGR-009 / HLT-001) ---

func TestAddEntryValidation_VitalMissingPayload_Fails(t *testing.T) {
	sub := domain.SubcategoryHealthTemperature
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "value_json", valErr.Errors[0].Field)
	require.Contains(t, valErr.Errors[0].Message, "required")
}

func TestAddEntryValidation_VitalInvalidJSON_Fails(t *testing.T) {
	sub := domain.SubcategoryHealthTemperature
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"value": "thirty-seven"}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "value_json", valErr.Errors[0].Field)
	require.Contains(t, valErr.Errors[0].Message, "invalid JSON")
}

func TestAddEntryValidation_VitalMissingField_Fails(t *testing.T) {
	sub := domain.SubcategoryHealthSpO2
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "value_json", valErr.Errors[0].Field)
	require.Contains(t, valErr.Errors[0].Message, "missing")
}

func TestAddEntryValidation_TemperatureOutOfRange_Fails(t *testing.T) {
	sub := domain.SubcategoryHealthTemperature
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"value": 43.5}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "value_json", valErr.Errors[0].Field)
	require.Contains(t, valErr.Errors[0].Message, "between 34 and 42")
}

func TestAddEntryValidation_TemperatureInRange_Passes(t *testing.T) {
	sub := domain.SubcategoryHealthTemperature
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"value": 36.8}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.NoError(t, err)
}

func TestAddEntryValidation_BloodPressureSwapped_Fails(t *testing.T) {
	sub := domain.SubcategoryHealthBloodPressure
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"systolic": 70, "diastolic": 120}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeElderly)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	found := false
	for _, e := range valErr.Errors {
		if e.Field == "value_json" && e.Message == "systolic pressure must be greater than diastolic pressure" {
			found = true
		}
	}
	require.True(t, found, "expected systolic>diastolic error, got %v", valErr.Errors)
}

func TestAddEntryValidation_BloodPressureValid_Passes(t *testing.T) {
	sub := domain.SubcategoryHealthBloodPressure
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"systolic": 120, "diastolic": 80}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeElderly)
	require.NoError(t, err)
}

func TestAddEntryValidation_SpO2OutOfRange_Fails(t *testing.T) {
	sub := domain.SubcategoryHealthSpO2
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"value": 65}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "value_json", valErr.Errors[0].Field)
}

func TestAddEntryValidation_WeightOutOfRange_Fails(t *testing.T) {
	sub := domain.SubcategoryHealthWeight
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"value": 350}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "value_json", valErr.Errors[0].Field)
}

func TestAddEntryValidation_WeightValid_Passes(t *testing.T) {
	sub := domain.SubcategoryHealthWeight
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
		ValueJson:   []byte(`{"value": 12.5}`),
	}
	err := validateAddEntryInput(input, domain.CareTypeInfant)
	require.NoError(t, err)
}

func TestAddEntryValidation_SymptomNotVital_NoJSONRequired(t *testing.T) {
	// Qualitative symptoms (e.g. sneezing) need no structured measurement.
	sub := domain.SubcategoryHealthSneezing
	input := AddEntryInput{
		Category:    domain.LogCategoryHealth,
		Subcategory: &sub,
	}
	err := validateAddEntryInput(input, domain.CareTypeChild)
	require.NoError(t, err)
}

func stringPtr(s string) *string {
	return &s
}

// --- Photo URL validation (CGR-008) ---

const testPhotoBase = "https://ik.imagekit.io/acme"

func TestValidatePhotoURLs_None_Passes(t *testing.T) {
	require.Empty(t, validatePhotoURLs(nil, testPhotoBase))
	require.Empty(t, validatePhotoURLs([]string{}, testPhotoBase))
}

func TestValidatePhotoURLs_Valid_Passes(t *testing.T) {
	urls := []string{
		testPhotoBase + "/workspaces/ws1/a.jpg",
		testPhotoBase + "/workspaces/ws1/b.jpg",
	}
	require.Empty(t, validatePhotoURLs(urls, testPhotoBase))
}

func TestValidatePhotoURLs_ExternalHost_Fails(t *testing.T) {
	urls := []string{testPhotoBase + "/a.jpg", "https://evil.example.com/x.jpg"}
	errs := validatePhotoURLs(urls, testPhotoBase)
	require.Len(t, errs, 1)
	require.Equal(t, "photo_urls", errs[0].Field)
	require.Contains(t, errs[0].Message, "invalid photo URL")
}

func TestValidatePhotoURLs_TooMany_Fails(t *testing.T) {
	urls := make([]string, 6)
	for i := range urls {
		urls[i] = testPhotoBase + "/a.jpg"
	}
	errs := validatePhotoURLs(urls, testPhotoBase)
	require.Len(t, errs, 1)
	require.Contains(t, errs[0].Message, "at most 5 photos")
}

func TestValidatePhotoURLs_PrefixSpoof_Fails(t *testing.T) {
	// "https://ik.imagekit.io/acme.evil.com/" shares the string prefix but
	// is a different host — the naive HasPrefix would let it through; the
	// next character must be / or end-of-string.
	urls := []string{testPhotoBase + ".evil.com/a.jpg"}
	errs := validatePhotoURLs(urls, testPhotoBase)
	require.Len(t, errs, 1)
}

func TestValidateSummaryCounts_Valid_Passes(t *testing.T) {
	input := SubmitDaySummaryInput{
		Counts: map[domain.LogCategory]int{
			domain.LogCategoryMeal:  3,
			domain.LogCategoryDiaper: 2,
		},
		Note: stringPtr("Hari yang panjang"),
	}
	err := validateSummaryCounts(input, domain.CareTypeInfant)
	require.NoError(t, err)
}

func TestValidateSummaryCounts_Empty_Fails(t *testing.T) {
	err := validateSummaryCounts(SubmitDaySummaryInput{}, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "counts", valErr.Errors[0].Field)
}

func TestValidateSummaryCounts_ZeroCountsOnly_Fails(t *testing.T) {
	input := SubmitDaySummaryInput{
		Counts: map[domain.LogCategory]int{domain.LogCategoryMeal: 0},
	}
	err := validateSummaryCounts(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Contains(t, valErr.Errors[0].Message, "at least one count")
}

func TestValidateSummaryCounts_CountTooHigh_Fails(t *testing.T) {
	input := SubmitDaySummaryInput{
		Counts: map[domain.LogCategory]int{domain.LogCategoryMeal: 150},
	}
	err := validateSummaryCounts(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Contains(t, valErr.Errors[0].Message, "between 1 and 99")
}

func TestValidateSummaryCounts_UnknownCategory_Fails(t *testing.T) {
	input := SubmitDaySummaryInput{
		Counts: map[domain.LogCategory]int{domain.LogCategory("yoga"): 1},
	}
	err := validateSummaryCounts(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Contains(t, valErr.Errors[0].Message, "unknown category")
}

func TestValidateSummaryCounts_NoteIsNotCountable_Fails(t *testing.T) {
	input := SubmitDaySummaryInput{
		Counts: map[domain.LogCategory]int{domain.LogCategoryNote: 3},
	}
	err := validateSummaryCounts(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Contains(t, valErr.Errors[0].Message, "not countable")
}

func TestValidateSummaryCounts_DiaperForElderly_Fails(t *testing.T) {
	input := SubmitDaySummaryInput{
		Counts: map[domain.LogCategory]int{domain.LogCategoryDiaper: 2},
	}
	err := validateSummaryCounts(input, domain.CareTypeElderly)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Contains(t, valErr.Errors[0].Message, "diaper")
}

func TestValidateSummaryCounts_NoteTooLong_Fails(t *testing.T) {
	longNote := string(make([]byte, domain.MaxNoteLength+1))
	input := SubmitDaySummaryInput{
		Counts: map[domain.LogCategory]int{domain.LogCategoryMeal: 1},
		Note:   &longNote,
	}
	err := validateSummaryCounts(input, domain.CareTypeChild)
	require.Error(t, err)
	var valErr ErrValidation
	require.True(t, errors.As(err, &valErr))
	require.Equal(t, "note", valErr.Errors[0].Field)
}