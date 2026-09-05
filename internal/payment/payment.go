package payment

import (
	"errors"
)

// Provider defines the interface for payment operations.
type Provider interface {
	CreateSubscription(workspaceID string, plan string) (string, error)
	GetSubscriptionStatus(subID string) (string, error)
	CancelSubscription(subID string) error
}

// Config holds payment gateway settings.
type Config struct {
	Provider string
	APIKey   string
	Secret   string
}

// NewProvider returns a configured payment provider based on the config.
func NewProvider(cfg Config) (Provider, error) {
	switch cfg.Provider {
	case "doku":
		return NewDOKU(cfg), nil
	case "mayar":
		return NewMayar(cfg), nil
	default:
		return nil, errors.New("unsupported payment provider")
	}
}

// DOKU implementation
type DOKU struct{ cfg Config }

func NewDOKU(cfg Config) *DOKU { return &DOKU{cfg} }
func (d *DOKU) CreateSubscription(wID, plan string) (string, error) { return "doku_sub_123", nil }
func (d *DOKU) GetSubscriptionStatus(id string) (string, error)    { return "active", nil }
func (d *DOKU) CancelSubscription(id string) error                 { return nil }

// Mayar implementation
type Mayar struct{ cfg Config }

func NewMayar(cfg Config) *Mayar { return &Mayar{cfg} }
func (m *Mayar) CreateSubscription(wID, plan string) (string, error) { return "mayar_sub_456", nil }
func (m *Mayar) GetSubscriptionStatus(id string) (string, error)    { return "active", nil }
func (m *Mayar) CancelSubscription(id string) error                 { return nil }
