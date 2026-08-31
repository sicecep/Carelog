package mail

import (
	"fmt"
	"strings"
)

// categoryLabelsID/EN mirror web/src/messages/{id,en}.json onboarding.modules
// so the digest email uses the same vocabulary the app shows (LOG-004 i18n).
var categoryLabelsID = map[string]string{
	"meal": "Makanan", "sleep": "Tidur", "diaper": "Popok", "medication": "Obat",
	"activity": "Aktivitas", "mood": "Suasana hati", "health": "Kesehatan",
	"learning": "Belajar", "therapy": "Terapi", "note": "Catatan", "other": "Lainnya",
}

var categoryLabelsEN = map[string]string{
	"meal": "Meal", "sleep": "Sleep", "diaper": "Diaper", "medication": "Medication",
	"activity": "Activity", "mood": "Mood", "health": "Health",
	"learning": "Learning", "therapy": "Therapy", "note": "Note", "other": "Other",
}

var severityLabelsID = map[string]string{"low": "rendah", "medium": "sedang", "high": "tinggi", "emergency": "darurat"}
var severityLabelsEN = map[string]string{"low": "low", "medium": "medium", "high": "high", "emergency": "emergency"}

func categoryLabel(category, locale string) string {
	m := categoryLabelsID
	if locale == "en" {
		m = categoryLabelsEN
	}
	if label, ok := m[category]; ok {
		return label
	}
	return category
}

func severityLabel(severity, locale string) string {
	m := severityLabelsID
	if locale == "en" {
		m = severityLabelsEN
	}
	if label, ok := m[severity]; ok {
		return label
	}
	return severity
}

func roleLabel(role, locale string) string {
	if locale == "en" {
		return role
	}
	if role == "owner" {
		return "pemilik"
	}
	return "pengasuh"
}

// digestCopy is the locale-dependent copy for the digest email.
type digestCopy struct {
	subjectPrefix string
	heading       string
	footer        string
	noEntries     string
	shiftHeading  string
	incidents     string
	submitted     string
	notSubmitted  string
	entries       string
	totalSleep    string
	hourSuffix    string
	severityWord  string
	cta           string
	incidentWord  string
}

var copyID = digestCopy{
	subjectPrefix: "Ringkasan harian Carelog",
	heading:       "Ringkasan harian",
	footer:        "Email ini dikirim otomatis setiap hari pukul 17:00 WIB. — Tim Carelog",
	noEntries:     "Belum ada aktivitas tercatat hari ini.",
	shiftHeading:  "Ringkasan shift",
	incidents:     "Insiden",
	submitted:     "disubmit",
	notSubmitted:  "belum disubmit",
	entries:       "entri",
	totalSleep:    "Total tidur",
	hourSuffix:    " jam",
	severityWord:  "tingkat",
	cta:           "Lihat laporan lengkap",
	incidentWord:  "Insiden",
}

var copyEN = digestCopy{
	subjectPrefix: "Carelog daily summary",
	heading:       "Daily summary",
	footer:        "This email is sent automatically every day at 17:00 WIB. — The Carelog Team",
	noEntries:     "No entries today.",
	shiftHeading:  "Shift summary",
	incidents:     "Incidents",
	submitted:     "submitted",
	notSubmitted:  "not submitted",
	entries:       "entries",
	totalSleep:    "Total sleep",
	hourSuffix:    " hrs",
	severityWord:  "severity",
	cta:           "View full report",
	incidentWord:  "Incident",
}

func copyFor(locale string) (digestCopy, string) {
	if locale == "en" {
		return copyEN, "en"
	}
	return copyID, "id"
}

// renderDigestEmail returns subject, HTML body, and text body.
func renderDigestEmail(data DigestEmailData) (subject, htmlBody, textBody string) {
	c, locale := copyFor(data.Locale)

	subject = fmt.Sprintf("%s — %s — %s", c.subjectPrefix, data.WorkspaceName, data.Date)

	var sections, textSections strings.Builder
	for _, r := range data.Recipients {
		sections.WriteString(renderRecipientSection(r, c, locale))
		textSections.WriteString(renderRecipientSectionText(r, c, locale))
	}

	htmlBody = fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>%s</title>
</head>
<body style="font-family: sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px; margin: 0 auto; padding: 24px;">
	<div style="background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
		<div style="text-align: center; margin-bottom: 24px;">
			<h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #111827;">Carelog</h1>
			<p style="margin: 4px 0 0; font-size: 14px; color: #6b7280;">%s — %s — %s</p>
		</div>
%s
		<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
		<p style="margin: 0; font-size: 12px; color: #9ca3af;">%s</p>
	</div>
</body>
</html>
`, c.subjectPrefix, c.heading, data.WorkspaceName, data.Date, sections.String(), c.footer)

	textBody = fmt.Sprintf("%s — %s — %s\n%s\n%s\n", c.subjectPrefix, data.WorkspaceName, data.Date, textSections.String(), c.footer)

	return subject, htmlBody, textBody
}

func renderRecipientSection(r RecipientDigestData, c digestCopy, locale string) string {
	var b strings.Builder
	fmt.Fprintf(&b, `
		<div style="margin: 24px 0; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px;">
			<h2 style="margin: 0 0 12px; font-size: 17px; font-weight: 600; color: #111827;">%s</h2>`, r.RecipientName)

	if !r.HasEntries {
		fmt.Fprintf(&b, `<p style="margin: 0 0 12px; font-size: 14px; color: #6b7280;">%s</p>`, c.noEntries)
	} else {
		b.WriteString(`<table style="width: 100%; border-collapse: collapse; margin-bottom: 12px;">`)
		for _, cat := range r.Categories {
			fmt.Fprintf(&b, `<tr><td style="padding: 4px 0; font-size: 14px; color: #374151;">%s</td><td style="padding: 4px 0; font-size: 14px; color: #111827; text-align: right; font-weight: 600;">%d</td></tr>`,
				categoryLabel(cat.Category, locale), cat.Count)
		}
		if r.SleepMinutes != nil {
			fmt.Fprintf(&b, `<tr><td style="padding: 4px 0; font-size: 14px; color: #374151;">%s</td><td style="padding: 4px 0; font-size: 14px; color: #111827; text-align: right; font-weight: 600;">%.1f%s</td></tr>`,
				c.totalSleep, *r.SleepMinutes/60, c.hourSuffix)
		}
		b.WriteString(`</table>`)

		if len(r.Shifts) > 0 {
			fmt.Fprintf(&b, `<p style="margin: 12px 0 4px; font-size: 13px; font-weight: 600; color: #6b7280;">%s</p><ul style="margin: 0 0 12px; padding-left: 18px; font-size: 13px; color: #374151;">`, c.shiftHeading)
			for _, s := range r.Shifts {
				status := c.notSubmitted
				if s.Submitted {
					status = c.submitted
				}
				fmt.Fprintf(&b, `<li>%s (%s): %d %s, %s</li>`,
					s.ContributorName, roleLabel(s.ContributorRole, locale), s.EntryCount, c.entries, status)
			}
			b.WriteString(`</ul>`)
		}
	}

	if len(r.Incidents) > 0 {
		fmt.Fprintf(&b, `<p style="margin: 12px 0 4px; font-size: 13px; font-weight: 600; color: #b91c1c;">%s (%d)</p><ul style="margin: 0 0 12px; padding-left: 18px; font-size: 13px; color: #b91c1c;">`, c.incidents, len(r.Incidents))
		for _, inc := range r.Incidents {
			fmt.Fprintf(&b, `<li>%s — %s %s, %s</li>`, inc.Type, c.severityWord, severityLabel(inc.Severity, locale), inc.OccurredAt)
		}
		b.WriteString(`</ul>`)
	}

	fmt.Fprintf(&b, `<a href="%s" style="display: inline-block; margin-top: 8px; color: #2563eb; font-weight: 600; font-size: 14px; text-decoration: none;">%s &rarr;</a></div>`, r.DeepLink, c.cta)
	return b.String()
}

func renderRecipientSectionText(r RecipientDigestData, c digestCopy, locale string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "\n%s\n", r.RecipientName)
	if !r.HasEntries {
		fmt.Fprintf(&b, "%s\n", c.noEntries)
	} else {
		for _, cat := range r.Categories {
			fmt.Fprintf(&b, "- %s: %d\n", categoryLabel(cat.Category, locale), cat.Count)
		}
		if r.SleepMinutes != nil {
			fmt.Fprintf(&b, "- %s: %.1f%s\n", c.totalSleep, *r.SleepMinutes/60, c.hourSuffix)
		}
		for _, s := range r.Shifts {
			status := c.notSubmitted
			if s.Submitted {
				status = c.submitted
			}
			fmt.Fprintf(&b, "- %s (%s): %d %s, %s\n",
				s.ContributorName, roleLabel(s.ContributorRole, locale), s.EntryCount, c.entries, status)
		}
	}
	for _, inc := range r.Incidents {
		fmt.Fprintf(&b, "! %s: %s — %s %s, %s\n", c.incidentWord, inc.Type, c.severityWord, severityLabel(inc.Severity, locale), inc.OccurredAt)
	}
	fmt.Fprintf(&b, "%s: %s\n", c.cta, r.DeepLink)
	return b.String()
}
