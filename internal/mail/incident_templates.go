package mail

import (
	"fmt"
	"html"
	"strings"
)

// incidentCopy is the locale-dependent copy for the OWN-012 alert email.
type incidentCopy struct {
	urgentPrefix string // subject prefix for high/emergency
	calmPrefix   string // subject prefix for low/medium
	urgentLead   string // banner line for high/emergency
	calmLead     string
	recipient    string
	reportedBy   string
	when         string
	whatHappened string
	actionTaken  string
	noAction     string
	severityWord string
	cta          string
	footer       string
}

var incidentCopyID = incidentCopy{
	urgentPrefix: "🚨 INSIDEN MENDESAK",
	calmPrefix:   "Laporan insiden",
	urgentLead:   "Insiden mendesak dilaporkan. Mohon segera periksa.",
	calmLead:     "Sebuah insiden dicatat untuk hari ini.",
	recipient:    "Yang dirawat",
	reportedBy:   "Dilaporkan oleh",
	when:         "Waktu kejadian",
	whatHappened: "Kejadian",
	actionTaken:  "Tindakan yang sudah dilakukan",
	noAction:     "Belum ada tindakan yang dicatat.",
	severityWord: "Tingkat",
	cta:          "Lihat detail insiden",
	footer:       "Anda menerima email ini karena Anda pemilik ruang kerja CareLog ini.",
}

var incidentCopyEN = incidentCopy{
	urgentPrefix: "🚨 URGENT INCIDENT",
	calmPrefix:   "Incident report",
	urgentLead:   "An urgent incident was reported. Please check in now.",
	calmLead:     "An incident was logged today.",
	recipient:    "Care recipient",
	reportedBy:   "Reported by",
	when:         "Time of incident",
	whatHappened: "What happened",
	actionTaken:  "Action already taken",
	noAction:     "No action recorded yet.",
	severityWord: "Severity",
	cta:          "View incident details",
	footer:       "You are receiving this because you own this CareLog workspace.",
}

func incidentCopyFor(locale string) (incidentCopy, string) {
	if locale == "en" {
		return incidentCopyEN, "en"
	}
	return incidentCopyID, "id"
}

// severityBanner returns the background and text colour for the severity
// banner. Mirrors the in-app severity palette (amber → red → deep red) so an
// owner sees the same visual language in email and app.
func severityBanner(severity string, urgent bool) (bg, fg string) {
	switch severity {
	case "emergency":
		return "#7B241C", "#ffffff" // deep red, matches --color-error-ink
	case "high":
		return "#C0392B", "#ffffff" // --color-error
	case "medium":
		return "#FADBD8", "#7B241C" // --color-error-soft
	default:
		if urgent {
			// Unknown severity: IsUrgent() fails loud, so does the banner.
			return "#C0392B", "#ffffff"
		}
		return "#FEF3C7", "#78350F" // amber, the "low" tier
	}
}

// renderIncidentAlertEmail returns subject, HTML body, and text body for the
// OWN-012 alert. Every interpolated field is user-supplied (description,
// names), so all of them are HTML-escaped — an incident description is free
// text typed by a caregiver mid-crisis, not a trusted template input.
func renderIncidentAlertEmail(data IncidentAlertData) (subject, htmlBody, textBody string) {
	c, _ := incidentCopyFor(data.Locale)

	prefix := c.calmPrefix
	lead := c.calmLead
	if data.Urgent {
		prefix = c.urgentPrefix
		lead = c.urgentLead
	}

	severityLabelText := severityLabel(data.Severity, data.Locale)
	typeLabelText := incidentTypeLabel(data.Type, data.Locale)

	// Subject leads with urgency, then who and what: an owner scanning a
	// phone lock screen must get the gist without opening anything.
	subject = fmt.Sprintf("%s — %s — %s", prefix, esc(data.RecipientName), typeLabelText)

	bg, fg := severityBanner(data.Severity, data.Urgent)

	action := esc(data.ActionTaken)
	if strings.TrimSpace(data.ActionTaken) == "" {
		action = c.noAction
	}

	htmlBody = fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>%s</title>
</head>
<body style="font-family: sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
	<div style="background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
		<div style="background: %s; color: %s; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 24px;">
			<p style="margin: 0; font-size: 18px; font-weight: 700;">%s</p>
			<p style="margin: 6px 0 0; font-size: 14px;">%s: %s</p>
		</div>
		<p style="margin: 0 0 20px; font-size: 16px;">%s</p>
		<table style="width: 100%%; border-collapse: collapse; font-size: 15px;">
			<tr><td style="padding: 6px 0; color: #6b7280; width: 40%%;">%s</td><td style="padding: 6px 0; font-weight: 600;">%s</td></tr>
			<tr><td style="padding: 6px 0; color: #6b7280;">%s</td><td style="padding: 6px 0; font-weight: 600;">%s</td></tr>
			<tr><td style="padding: 6px 0; color: #6b7280;">%s</td><td style="padding: 6px 0; font-weight: 600;">%s</td></tr>
		</table>
		<h2 style="margin: 24px 0 6px; font-size: 15px; color: #6b7280; font-weight: 600;">%s</h2>
		<p style="margin: 0; font-size: 16px; white-space: pre-wrap;">%s</p>
		<h2 style="margin: 20px 0 6px; font-size: 15px; color: #6b7280; font-weight: 600;">%s</h2>
		<p style="margin: 0; font-size: 16px; white-space: pre-wrap;">%s</p>
		<div style="text-align: center; margin: 28px 0 8px;">
			<a href="%s" style="display: inline-block; background: %s; color: %s; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">%s</a>
		</div>
		<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
		<p style="margin: 0; font-size: 12px; color: #9ca3af;">%s</p>
	</div>
</body>
</html>
`,
		esc(subject),
		bg, fg, esc(typeLabelText), c.severityWord, esc(severityLabelText),
		lead,
		c.recipient, esc(data.RecipientName),
		c.reportedBy, esc(data.ReporterName),
		c.when, esc(data.OccurredAt),
		c.whatHappened, esc(data.Description),
		c.actionTaken, action,
		esc(data.DeepLink), bg, fg, c.cta,
		c.footer,
	)

	var t strings.Builder
	fmt.Fprintf(&t, "%s\n\n%s\n\n", subject, lead)
	fmt.Fprintf(&t, "%s: %s\n", c.severityWord, severityLabelText)
	fmt.Fprintf(&t, "%s: %s\n", c.recipient, data.RecipientName)
	fmt.Fprintf(&t, "%s: %s\n", c.reportedBy, data.ReporterName)
	fmt.Fprintf(&t, "%s: %s\n\n", c.when, data.OccurredAt)
	fmt.Fprintf(&t, "%s:\n%s\n\n", c.whatHappened, data.Description)
	if strings.TrimSpace(data.ActionTaken) == "" {
		fmt.Fprintf(&t, "%s:\n%s\n\n", c.actionTaken, c.noAction)
	} else {
		fmt.Fprintf(&t, "%s:\n%s\n\n", c.actionTaken, data.ActionTaken)
	}
	fmt.Fprintf(&t, "%s: %s\n\n%s\n", c.cta, data.DeepLink, c.footer)

	return subject, htmlBody, t.String()
}

// esc escapes user-supplied text for HTML interpolation.
func esc(s string) string { return html.EscapeString(s) }

// incidentTypeLabel renders an incident type in the target locale.
func incidentTypeLabel(t, locale string) string {
	id := map[string]string{
		"fall":          "Jatuh",
		"injury":        "Cedera",
		"medical":       "Medis",
		"behavioral":    "Perilaku",
		"environmental": "Lingkungan",
		"other":         "Lainnya",
	}
	en := map[string]string{
		"fall":          "Fall",
		"injury":        "Injury",
		"medical":       "Medical",
		"behavioral":    "Behavioral",
		"environmental": "Environmental",
		"other":         "Other",
	}
	m := id
	if locale == "en" {
		m = en
	}
	if label, ok := m[t]; ok {
		return label
	}
	return t
}
