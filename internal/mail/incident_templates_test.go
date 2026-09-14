package mail

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSeverityIsUrgentTieringInEmail(t *testing.T) {
	base := IncidentAlertData{
		WorkspaceName: "Keluarga Test",
		RecipientName: "Adik Bayi",
		ReporterName:  "Bu Sari",
		Type:          "fall",
		Description:   "Terjatuh dari tempat tidur",
		OccurredAt:    "13 Sep 2026, 15:04",
		DeepLink:      "https://app.test/id/recipients/abc",
	}

	tests := []struct {
		name         string
		severity     string
		urgent       bool
		locale       string
		wantSubject  string
		wantNotInSub string
	}{
		{name: "emergency ID is urgent", severity: "emergency", urgent: true, locale: "id", wantSubject: "INSIDEN MENDESAK"},
		{name: "high EN is urgent", severity: "high", urgent: true, locale: "en", wantSubject: "URGENT INCIDENT"},
		{name: "medium ID is calm", severity: "medium", urgent: false, locale: "id", wantSubject: "Laporan insiden", wantNotInSub: "MENDESAK"},
		{name: "low EN is calm", severity: "low", urgent: false, locale: "en", wantSubject: "Incident report", wantNotInSub: "URGENT"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := base
			d.Severity = tt.severity
			d.Urgent = tt.urgent
			d.Locale = tt.locale

			subject, html, text := renderIncidentAlertEmail(d)
			require.Contains(t, subject, tt.wantSubject)
			if tt.wantNotInSub != "" {
				require.NotContains(t, subject, tt.wantNotInSub)
			}
			// Recipient name and description must reach the reader in both
			// bodies — the whole point of the alert.
			require.Contains(t, html, "Adik Bayi")
			require.Contains(t, text, "Terjatuh dari tempat tidur")
			require.Contains(t, html, d.DeepLink)
		})
	}
}

func TestIncidentAlertEscapesUserText(t *testing.T) {
	// Description is free text typed by a caregiver; it must never be able
	// to inject markup into the owner's email client.
	d := IncidentAlertData{
		RecipientName: `<img src=x onerror=alert(1)>`,
		ReporterName:  "Bu Sari",
		Type:          "injury",
		Severity:      "high",
		Urgent:        true,
		Description:   `<script>alert("xss")</script>`,
		OccurredAt:    "13 Sep 2026, 15:04",
		Locale:        "id",
		DeepLink:      "https://app.test/id/recipients/abc",
	}
	_, html, _ := renderIncidentAlertEmail(d)
	require.NotContains(t, html, "<script>")
	require.NotContains(t, html, "<img src=x")
	require.Contains(t, html, "&lt;script&gt;")
}

func TestIncidentAlertNoActionFallback(t *testing.T) {
	d := IncidentAlertData{
		RecipientName: "Adik", ReporterName: "Bu Sari", Type: "fall",
		Severity: "low", Locale: "id", ActionTaken: "   ",
		Description: "x", DeepLink: "https://app.test",
	}
	_, html, text := renderIncidentAlertEmail(d)
	require.Contains(t, html, "Belum ada tindakan")
	require.Contains(t, text, "Belum ada tindakan")
}

func TestSeverityBannerColours(t *testing.T) {
	// Emergency must be visually distinct from high — the severity design
	// calls for deep red vs red.
	emBg, _ := severityBanner("emergency", true)
	hiBg, _ := severityBanner("high", true)
	medBg, _ := severityBanner("medium", false)
	lowBg, _ := severityBanner("low", false)
	require.NotEqual(t, emBg, hiBg)
	require.NotEqual(t, hiBg, medBg)
	require.NotEqual(t, medBg, lowBg)
	// Unknown severity falls back to the urgent palette (fail loud).
	unkBg, _ := severityBanner("bogus", true)
	require.Equal(t, hiBg, unkBg)
}

func TestIncidentTypeLabelLocales(t *testing.T) {
	require.Equal(t, "Jatuh", incidentTypeLabel("fall", "id"))
	require.Equal(t, "Fall", incidentTypeLabel("fall", "en"))
	// Unknown types pass through rather than rendering an empty string.
	require.Equal(t, "spelunking", incidentTypeLabel("spelunking", "en"))
	require.False(t, strings.Contains(incidentTypeLabel("other", "id"), "other"))
}
