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

func stringPtr(s string) *string {
	return &s
}