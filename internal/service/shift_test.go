package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// A simple test for the business logic errors.

func TestShift_Validation(t *testing.T) {
	t.Run("invalid handoff note fails validation", func(t *testing.T) {
		note := string(make([]byte, 501))
		_, err := CheckOutShift(
			context.Background(),
			nil, // q
			uuid.New(),
			uuid.New(),
			&note,
		)
		require.Error(t, err)
		require.Contains(t, err.Error(), "must be at most 500 characters")
	})
}
