package mail

import (
	"fmt"
	"html"
	"strings"
)

// ReminderEmailData holds everything needed to render the NOT-001 caregiver
// reminder. Deliberately small: the reminder's job is to get the caregiver
// back into the app, not to summarize the day (that is the owner's digest).
type ReminderEmailData struct {
	CaregiverName string
	WorkspaceName string
	// LogURL deep-links to the logging screen (AC 2) so the caregiver is one
	// tap from the thing the email is asking for.
	LogURL string
	// SettingsURL lets them snooze or turn reminders off (AC 6). Every
	// automated nag must carry its own off switch, or it trains people to
	// filter the sender — including the emails that matter.
	SettingsURL string
	Locale      string // "id" | "en"
}

type reminderCopy struct {
	subject   string
	heading   string
	body      string
	cta       string
	manage    string
	footer    string
	greeting  string
}

var reminderCopyID = reminderCopy{
	subject:  "Pengingat: catatan hari ini belum diisi",
	heading:  "Belum ada catatan hari ini",
	greeting: "Halo %s,",
	body:     "Sampai pukul 17.00 WIB belum ada catatan perawatan yang masuk untuk %s hari ini. Jika Anda sempat, mohon catat sekarang selagi masih ingat.",
	cta:      "Catat sekarang",
	manage:   "Atur atau matikan pengingat",
	footer:   "Anda menerima email ini karena Anda pengasuh aktif di %s. — Tim Carelog",
}

var reminderCopyEN = reminderCopy{
	subject:  "Reminder: today's care log is empty",
	heading:  "No entries logged today",
	greeting: "Hi %s,",
	body:     "As of 5 PM, no care entries have been logged for %s today. If you have a moment, please log them now while the day is still fresh.",
	cta:      "Log now",
	manage:   "Manage or turn off reminders",
	footer:   "You're receiving this because you're an active caregiver at %s. — The Carelog Team",
}

func reminderCopyFor(locale string) reminderCopy {
	if locale == "en" {
		return reminderCopyEN
	}
	return reminderCopyID
}

// renderReminderEmail builds subject/html/text for the caregiver reminder.
//
// Every interpolated value is HTML-escaped: a workspace name is user-supplied
// ("Keluarga <script>") and this template is assembled by concatenation, so
// escaping is the only thing standing between a household display name and
// an injected payload in someone's inbox.
func renderReminderEmail(d ReminderEmailData) (subject, htmlBody, textBody string) {
	c := reminderCopyFor(d.Locale)

	name := d.CaregiverName
	if strings.TrimSpace(name) == "" {
		// Falling back to a bare greeting reads better than "Hi ,".
		name = strings.TrimSuffix(strings.TrimSuffix(c.greeting, " %s,"), "%s,")
	}

	subject = c.subject
	greeting := fmt.Sprintf(c.greeting, name)
	body := fmt.Sprintf(c.body, d.WorkspaceName)
	footer := fmt.Sprintf(c.footer, d.WorkspaceName)

	htmlBody = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f7f8;margin:0;padding:24px">` +
		`<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">` +
		`<h1 style="margin:0 0 16px;font-size:20px;color:#111">` + html.EscapeString(c.heading) + `</h1>` +
		`<p style="margin:0 0 12px;font-size:16px;color:#333">` + html.EscapeString(greeting) + `</p>` +
		`<p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#333">` + html.EscapeString(body) + `</p>` +
		`<p style="margin:0 0 28px">` +
		`<a href="` + html.EscapeString(d.LogURL) + `" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:600">` +
		html.EscapeString(c.cta) + `</a></p>` +
		`<p style="margin:0 0 8px;font-size:13px;color:#666">` +
		`<a href="` + html.EscapeString(d.SettingsURL) + `" style="color:#666">` + html.EscapeString(c.manage) + `</a></p>` +
		`<p style="margin:0;font-size:12px;color:#999">` + html.EscapeString(footer) + `</p>` +
		`</div></body></html>`

	textBody = c.heading + "\n\n" +
		greeting + "\n\n" +
		body + "\n\n" +
		c.cta + ": " + d.LogURL + "\n" +
		c.manage + ": " + d.SettingsURL + "\n\n" +
		footer + "\n"

	return subject, htmlBody, textBody
}
