package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

// Since AcknowledgeIncident relies on Queries, I'll need a mock or test against a real DB.
// The existing recipient_test.go uses package service. Assuming it has access to a test-db
// via some setup I don't see yet. I will write a simple unit test for the business logic
// of AcknowledgeIncident assuming the `q` interface is satisfied.

func TestAcknowledgeIncident_Validation(t *testing.T) {
	t.Run("non-owner cannot acknowledge", func(t *testing.T) {
		_, err := AcknowledgeIncident(
			context.Background(),
			nil, // q
			uuid.New(),
			uuid.New(),
			uuid.New(),
			string(domain.RoleCaregiver),
			nil,
		)
		require.ErrorAs(t, err, &ErrNotOwner{})
	})

	t.Run("comment too long fails", func(t *testing.T) {
		comment := string(make([]byte, 501))
		_, err := AcknowledgeIncident(
			context.Background(),
			nil, // q
			uuid.New(),
			uuid.New(),
			uuid.New(),
			string(domain.RoleOwner),
			&comment,
		)
		require.Error(t, err)
		require.Contains(t, err.Error(), "must be at most 500 characters")
	})
}
