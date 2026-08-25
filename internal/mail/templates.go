// Package mail provides email sending abstractions for authentication flows.
package mail

import "fmt"

// renderMagicLinkEmail returns subject, HTML body, and text body for the magic link email.
// Supports Indonesian (id) and English (en) locales.
func renderMagicLinkEmail(data EmailData) (subject, htmlBody, textBody string) {
	switch data.Locale {
	case "en":
		return renderMagicLinkEmailEN(data)
	default: // "id" or any other defaults to Indonesian
		return renderMagicLinkEmailID(data)
	}
}

// renderMagicLinkEmailID renders the magic link email in Indonesian.
func renderMagicLinkEmailID(data EmailData) (string, string, string) {
	subject := "Masuk ke Carelog — tautan ajaib Anda"

	htmlBody := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Masuk ke Carelog</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 24px;">
	<div style="background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
		<div style="text-align: center; margin-bottom: 24px;">
			<h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #111827;">Carelog</h1>
		</div>

		<p style="margin: 0 0 16px; font-size: 16px;">Halo,</p>

		<p style="margin: 0 0 24px; font-size: 16px;">Klik tombol di bawah untuk masuk ke akun Carelog Anda. Tautan ini berlaku selama <strong>15 menit</strong> dan hanya bisa digunakan sekali.</p>

		<div style="text-align: center; margin: 32px 0;">
			<a href="%s" style="display: inline-block; background: #2563eb; color: #ffffff; font-weight: 600; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px;">Masuk ke Carelog</a>
		</div>

		<p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">Jika tombol di atas tidak berfungsi, salin tautan ini ke browser Anda:</p>
		<p style="margin: 8px 0 0; font-size: 13px; color: #2563eb; word-break: break-all;">%s</p>

		<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

		<p style="margin: 0; font-size: 13px; color: #9ca3af;">Jika Anda tidak meminta tautan ini, abaikan saja email ini. Akun Anda tetap aman.</p>
		<p style="margin: 8px 0 0; font-size: 13px; color: #9ca3af;">— Tim Carelog</p>
	</div>
</body>
</html>
`, data.Link, data.Link)

	textBody := fmt.Sprintf(`Masuk ke Carelog

Halo,

Klik tautan di bawah untuk masuk ke akun Carelog Anda. Tautan ini berlaku selama 15 menit dan hanya bisa digunakan sekali.

%s

Jika tautan di atas tidak berfungsi, salin tautan ini ke browser Anda:
%s

Jika Anda tidak meminta tautan ini, abaikan saja email ini. Akun Anda tetap aman.

— Tim Carelog`, data.Link, data.Link)

	return subject, htmlBody, textBody
}

// renderMagicLinkEmailEN renders the magic link email in English.
func renderMagicLinkEmailEN(data EmailData) (string, string, string) {
	subject := "Sign in to Carelog — your magic link"

	htmlBody := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Sign in to Carelog</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 24px;">
	<div style="background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
		<div style="text-align: center; margin-bottom: 24px;">
			<h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #111827;">Carelog</h1>
		</div>

		<p style="margin: 0 0 16px; font-size: 16px;">Hello,</p>

		<p style="margin: 0 0 24px; font-size: 16px;">Click the button below to sign in to your Carelog account. This link is valid for <strong>15 minutes</strong> and can only be used once.</p>

		<div style="text-align: center; margin: 32px 0;">
			<a href="%s" style="display: inline-block; background: #2563eb; color: #ffffff; font-weight: 600; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px;">Sign in to Carelog</a>
		</div>

		<p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">If the button above doesn't work, copy this link to your browser:</p>
		<p style="margin: 8px 0 0; font-size: 13px; color: #2563eb; word-break: break-all;">%s</p>

		<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

		<p style="margin: 0; font-size: 13px; color: #9ca3af;">If you didn't request this link, you can safely ignore this email. Your account remains secure.</p>
		<p style="margin: 8px 0 0; font-size: 13px; color: #9ca3af;">— The Carelog Team</p>
	</div>
</body>
</html>
`, data.Link, data.Link)

	textBody := fmt.Sprintf(`Sign in to Carelog

Hello,

Click the link below to sign in to your Carelog account. This link is valid for 15 minutes and can only be used once.

%s

If the link above doesn't work, copy this link to your browser:
%s

If you didn't request this link, you can safely ignore this email. Your account remains secure.

— The Carelog Team`, data.Link, data.Link)

	return subject, htmlBody, textBody
}