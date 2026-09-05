package payment

import "testing"

func TestNewProvider(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		wantName string
		wantErr  bool
	}{
		{"doku", "doku", "doku_sub_123", false},
		{"mayar", "mayar", "mayar_sub_456", false},
		{"unknown", "stripe", "", true},
		{"empty", "", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := NewProvider(Config{Provider: tt.provider})
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for provider %q, got nil", tt.provider)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			// Verify the correct adapter was selected by checking its subscription prefix.
			sub, err := p.CreateSubscription("ws-1", "pro")
			if err != nil {
				t.Fatalf("CreateSubscription: %v", err)
			}
			if sub != tt.wantName {
				t.Errorf("provider %q returned sub %q, want %q", tt.provider, sub, tt.wantName)
			}
		})
	}
}
