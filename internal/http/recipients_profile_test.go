package http

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

var profileNow = time.Date(2026, 11, 23, 3, 0, 0, 0, time.UTC)

func numeric(t *testing.T, f float64) pgtype.Numeric {
	t.Helper()
	n, err := service.NumericFromFloat(&f)
	require.NoError(t, err)
	return n
}

// TestMergeProfileDetails covers the keep / replace / clear rules for the
// optional profile fields, decoded from the JSON the edit sheet sends.
func TestMergeProfileDetails(t *testing.T) {
	current := store.CareRecipient{
		Gender:      pgtype.Text{String: "female", Valid: true},
		DateOfBirth: pgtype.Date{Time: time.Date(1950, 3, 14, 0, 0, 0, 0, time.UTC), Valid: true},
		WeightKg:    numeric(t, 52.5),
		HeightCm:    numeric(t, 150),
	}

	type want struct {
		gender string // "" means NULL
		dob    string // "" means NULL
		weight *float64
		height *float64
	}
	f := func(v float64) *float64 { return &v }
	kept := want{gender: "female", dob: "1950-03-14", weight: f(52.5), height: f(150)}

	tests := []struct {
		name      string
		body      string
		want      want
		wantField string // validation error field; "" means success
	}{
		{name: "absent keeps everything", body: `{}`, want: kept},
		{
			name: "values replace",
			body: `{"gender":"male","date_of_birth":"1948-01-02","weight_kg":60.25,"height_cm":165.5}`,
			want: want{gender: "male", dob: "1948-01-02", weight: f(60.25), height: f(165.5)},
		},
		{
			name: "explicit empty clears",
			body: `{"gender":"","date_of_birth":"","weight_kg":null,"height_cm":null}`,
			want: want{},
		},
		{
			name: "clearing one field keeps the rest",
			body: `{"weight_kg":null}`,
			want: want{gender: "female", dob: "1950-03-14", height: f(150)},
		},
		{name: "invalid gender", body: `{"gender":"robot"}`, wantField: "gender"},
		{name: "malformed date", body: `{"date_of_birth":"14/03/1950"}`, wantField: "date_of_birth"},
		{name: "future date", body: `{"date_of_birth":"2027-01-01"}`, wantField: "date_of_birth"},
		{name: "weight out of range", body: `{"weight_kg":500}`, wantField: "weight_kg"},
		{name: "height out of range", body: `{"height_cm":1.6}`, wantField: "height_cm"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var req UpdateRecipientRequest
			require.NoError(t, json.Unmarshal([]byte(tc.body), &req))

			got, err := mergeProfileDetails(req, current, profileNow)
			if tc.wantField != "" {
				var valErr service.ErrValidation
				require.True(t, errors.As(err, &valErr), "want validation error, got %v", err)
				require.Equal(t, tc.wantField, valErr.Errors[0].Field)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want.gender, pgTextFrom(got.Gender))
			require.Equal(t, tc.want.dob, formatDate(got.DateOfBirth))
			require.Equal(t, tc.want.weight, floatFromNumeric(got.WeightKg))
			require.Equal(t, tc.want.height, floatFromNumeric(got.HeightCm))
		})
	}
}

func TestOptionalFloatDecoding(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantSet bool
		want    *float64
		wantErr bool
	}{
		{name: "absent", body: `{}`},
		{name: "null", body: `{"weight_kg":null}`, wantSet: true},
		{name: "number", body: `{"weight_kg":12.5}`, wantSet: true, want: func() *float64 { v := 12.5; return &v }()},
		{name: "string is rejected", body: `{"weight_kg":"12"}`, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var req UpdateRecipientRequest
			err := json.Unmarshal([]byte(tc.body), &req)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.wantSet, req.WeightKg.Set)
			require.Equal(t, tc.want, req.WeightKg.Value)
		})
	}
}

func TestToRecipientResponse_ProfileDetails(t *testing.T) {
	r := store.CareRecipient{
		Gender:      pgtype.Text{String: "other", Valid: true},
		DateOfBirth: pgtype.Date{Time: time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC), Valid: true},
		WeightKg:    numeric(t, 11.4),
		HeightCm:    numeric(t, 82.5),
	}
	resp := toRecipientResponse(r)
	require.Equal(t, "other", resp.Gender)
	require.Equal(t, "2024-05-01", resp.DateOfBirth)
	require.InDelta(t, 11.4, *resp.WeightKg, 1e-9)
	require.InDelta(t, 82.5, *resp.HeightCm, 1e-9)

	empty := toRecipientResponse(store.CareRecipient{})
	require.Empty(t, empty.DateOfBirth)
	require.Nil(t, empty.WeightKg)
	require.Nil(t, empty.HeightCm)
}
