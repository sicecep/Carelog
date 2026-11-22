# Login Revamp (Owners & Caregivers) — Design Spec

**Date:** 2026-11-22
**Status:** Approved 2026-11-22
**Scope:** How owners/parents and caregivers sign in, recover access, and how the login screen works
**Supersedes:** PRD AUTH-001 (passwordless magic link) and the device-binding part of AUTH-005; RFC §8.1–8.3 ("Why not passwords", "Why PIN is device-bound")

---

## 1. Why

Owners sign in today with an **email magic link**, which sends one email per new sign-in. There is no email budget for production at launch, so login can't depend on sending email. Caregivers already sign in with **phone + 6-digit PIN**, but only on the device that enrolled the PIN. That breaks for caregivers who switch phones, or who use a shared household tablet.

## 2. Decisions (agreed 2026-11-22)

| # | Decision |
|---|---|
| D1 | **Owners:** **email or phone** + password, plus **Sign in with Google**. The magic link is retired from the product UI. |
| D2 | **Owner password reset:** **admin-assisted** at launch. The super-admin issues a temporary password from the admin dashboard. Emailed reset links come later, when there's an email budget. |
| D3 | **Caregivers:** identify with **phone number or username**, plus a 6-digit PIN. |
| D4 | **Caregiver PIN works on any device.** The device binding is removed from login. |
| D5 | **Support contact** for "Lupa kata sandi?" is the **platform owner's** WhatsApp (`SUPPORT_WHATSAPP`), who also performs admin resets. |
| D6 | A caregiver is **told in-app** when the owner changes their username. |
| D7 | Lockout backoff **caps at 24 hours**; the owner (or super-admin, for owners) can always unlock sooner. |

D4 makes the PIN the **only** secret for a caregiver account, so this spec adds the hardening in §6. That hardening is a condition of D4, not an optional extra.

## 3. Current state (as built)

- **Owners:** `POST /auth/magic-link` → email → `GET /auth/verify` → session. Owner registration needs super-admin approval (`users.approval_status`). Emails in `SUPER_ADMIN_EMAILS` are auto-approved. Google is not implemented; the button reads "Segera hadir".
- **Caregivers:** an invite link (shared over the owner's WhatsApp) leads to `POST /auth/pin/enrol`, which sets the PIN and enrols the device. Login is `POST /auth/pin/login` (phone + PIN + device cookie).
  - **Lockout:** 5 failures lock the account for 15 min (`user_pins.failed_count/locked_until`). The endpoint is also limited to 5 per 15 min per IP.
  - **Forgot PIN:** an owner-approved `pin_reset_requests` entry, tied to the requesting device.
- **Sessions:** Ed25519 JWT access token (15 min) plus a rotating refresh token (`REFRESH_TOKEN_TTL=720h`), both in httpOnly cookies. **Unchanged by this spec.**
- **Identity:** `users` has `email`, `phone` (E.164), `google_id`, and the constraint `email IS NOT NULL OR phone IS NOT NULL`. There's no password and no username anywhere.

---

## 4. Owners: email + password, and Google

### 4.1 Register
`/[locale]/register` (owner only) asks for **full name, email and/or phone (at least one), password, and password confirmation**. A phone is normalized to E.164 with `domain.NormalizePhone`, and the existing unique index on `users.phone` applies.

1. `POST /api/v1/auth/register` creates the user with `approval_status = 'pending'` and the password hash. No email is sent.
2. The response leads to the existing `/pending` screen ("menunggu persetujuan").
3. A super-admin approves the account in `/admin`, as today. Emails in `SUPER_ADMIN_EMAILS` are still auto-approved.

**Neither email nor phone is verified at signup**, because there's no email or SMS budget. The **admin approval gate is the control**: a person approves every owner, so a mistyped or squatted email or phone doesn't result in an active account. `email_verified_at` and `phone_verified_at` stay NULL for password signups; a Google sign-in sets `email_verified_at` (§4.4).

The response to a duplicate email or phone is the same as for a new one ("Jika email/nomor HP belum terdaftar, akun dibuat…"), so the endpoint can't be used to discover accounts. On a conflict, the user is pointed to login.

### 4.2 Login
`POST /api/v1/auth/password/login` takes `{ identifier, password }`. The identifier is an **email or a phone number**:
- If it contains `@`, look up by email, case-insensitively (existing `LOWER(email)` index).
- Otherwise, if `domain.NormalizePhone` accepts it, look up by phone.
- Anything else is treated as an unknown account.
- A wrong identifier and a wrong password produce **the same response and the same timing**: an unknown account still runs a dummy argon2id verification.
- **One account, two credentials.** A person can be an owner in one workspace and a caregiver in another with the same phone number, because `users.phone` is unique. The form decides which credential is checked: the owner form checks the password, the caregiver form checks the PIN. An account can hold both.
- Failed attempts count toward the per-account lockout in §6, kept on `user_passwords`.
- On success, the existing session-issuing code runs. Pending or rejected owners go to `/pending`, as today.
- If `must_change = true`, the response carries `password_change_required` and the web app sends the owner to a change-password screen before anything else.

### 4.3 Password rules
- **argon2id**, the same parameters and PHC-string format as the PINs (`internal/auth/pin.go`).
- **Length 8–128.** No composition rules ("one uppercase…"), following NIST 800-63B.
- **Reject the most common passwords:** a bundled list of about 1,000 common passwords, including Indonesian ones like `sayang123` and `bismillah`, plus the user's own email and phone number.
- Changing the password (`POST /api/v1/auth/password/change`, signed in) requires the **current password**. It revokes **every other refresh-token family** for the user; the current session stays.

### 4.4 Sign in with Google (AUTH-002, finally built)
- `GET /api/v1/auth/google` starts the flow, using `state` and PKCE in a short-lived httpOnly cookie. `GET /api/v1/auth/google/callback` exchanges the code, verifies the `id_token` (signature, `aud`, `iss`, `exp`), and requires `email_verified = true`.
- **Account matching:**
  1. If `google_id` matches, sign in.
  2. If the email matches an account **that already has `email_verified_at`**, link the Google ID and sign in.
  3. If the email matches an account whose email is **unverified** (a password signup), **don't link automatically.** Show: "Email ini sudah terdaftar. Masuk dengan kata sandi, lalu hubungkan Google di Pengaturan." Auto-linking here would hand the Google user's account to whoever registered that email first with a password, so an attacker could squat a victim's email and wait.
  4. If nothing matches, create a new owner with `email_verified_at` set and `approval_status = 'pending'`, so Google signups go through the same approval gate.
- **Linking from Settings** (signed in): "Hubungkan Google" runs the same flow and links `google_id`. It also sets `email_verified_at` when the Google email equals the account email.
- **Needs from the owner of this repo:** a Google Cloud OAuth client (`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`), with redirect URIs for local, staging and production. Until those exist, the Google button stays hidden. It shouldn't be shown as a dead "Segera hadir" button.

### 4.5 Forgot password: admin-assisted (D2)
- The login screen has a **"Lupa kata sandi?"** link that opens a short explanation and a **WhatsApp link to the platform owner** (D5: `SUPPORT_WHATSAPP` env var, `wa.me/<number>`, with a prefilled message "Halo, saya lupa kata sandi CareLog untuk <identifier>"). No email is sent. If `SUPPORT_WHATSAPP` is unset, the link is hidden and the text says to contact the CareLog admin.
- The super-admin opens `/admin`, finds the owner by name, email or phone, and taps **"Atur ulang kata sandi"**. This calls `POST /api/v1/admin/users/{id}/password-reset`, which:
  - generates a **random temporary password** (12 characters, readable alphabet), shown **once**;
  - sets `user_passwords.must_change = true`;
  - revokes all of the user's refresh-token families;
  - writes an `audit_logs` row (`action = 'password.admin_reset'`).
- The admin sends the temporary password to the owner over WhatsApp. On the next login the owner **must set a new password** (§4.2).
- **Later (not in scope):** an emailed reset link that reuses the `auth_magic_links` token machinery (hashed single-use token, 15-minute TTL) to reach a "set new password" page. That's one email per forgotten password, not one per login.

### 4.6 Existing magic-link owners
They have no password. At launch (pilot scale), the super-admin issues each of them a temporary password through §4.5, or they use Google when it's available. No automatic migration.

### 4.7 Magic link: retired from the UI, kept for dev
- The owner UI no longer offers it.
- `POST /auth/magic-link` and `GET /auth/verify` stay, behind a new flag `AUTH_MAGIC_LINK_ENABLED` (default **false**). The existing `AUTH_DEV_EXPOSE_LINK` dev/E2E fast path keeps working when both are on in development, so the E2E suite keeps its sign-in helper until it moves to passwords.

---

## 5. Caregivers: phone or username + PIN, any device

### 5.1 Identifier
- A caregiver has a **phone (E.164), a username, or both**. The identity constraint becomes `email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL`.
- **Username rules:**
  - 3–30 characters from `[a-z0-9._]`, stored lowercase, unique on `LOWER(username)` across the whole app (login has no workspace context).
  - Must contain at least one letter, so a username can never be confused with a phone number.
  - No leading or trailing `.` or `_`.
  - A small reserved list: `admin`, `carelog`, `support`, `owner`, and similar.
- **Login field:** a single input, "Nomor HP atau nama pengguna". If `domain.NormalizePhone` accepts it, look up by phone; otherwise look up by username, case-insensitively.

### 5.2 Who picks the username
- When creating an invite (Care Team → Undang), the owner enters the caregiver's **phone (optional)** and **username (optional)**. At least one is required. The username field suggests a value from the caregiver's name (e.g. `sari.pengasuh`) and checks availability as the owner types.
- The invite link carries neither as a secret. On claim (`POST /invites/{token}/claim-pin`), the caregiver confirms their phone if one was given and sets the PIN, and the account gets the invite's identifiers.
- The owner can **change a caregiver's username** later from Care Team. Old sessions stay valid; only the login identifier changes.
- **The caregiver is told (D6):** an in-app notification, shown on their next visit: "Nama pengguna Anda diganti menjadi `sari.pengasuh` oleh <owner name>." It's written to `notifications` like other in-app notices, and audit-logged as `member.username_changed`.

### 5.3 PIN works on any device (D4)
- `POST /api/v1/auth/pin/login` becomes `{ identifier, pin }`. **No device token is required.**
- `trusted_devices` stays, as **"known devices"**, which drives the new-device alert in §6:
  - each successful login upserts the device by its cookie;
  - a login from a **device not seen before** for that caregiver creates an in-app notification for the workspace owner(s): "Bu Sari masuk dari perangkat baru (Chrome · Android) pukul 08:12."
- The invite claim still sets a device cookie, so the first device counts as known.

### 5.4 PIN rules
- 6 digits, as today. **Reject the most common PINs** at enrolment and reset: `000000`, `111111` … `999999`, `123456`, `654321`, `123123`, `112233`, `121212`, and about 20 more from public PIN-frequency data. Also reject a PIN equal to the last 6 digits of the caregiver's own phone number.

### 5.5 Forgot PIN
Unchanged in principle: the request is **owner-approved** and tied to the requesting device (`pin_reset_requests.device_hash`), with a one-time re-enrolment token. The request form takes "nomor HP atau nama pengguna" instead of phone only.

---

## 6. Security hardening (a condition of D4)

With device binding removed, a caregiver identifier plus a 6-digit PIN is the whole credential: 10⁶ guesses, less after common PINs are blocked.

| Control | Detail | Status |
|---|---|---|
| Per-IP limit on `/auth/pin/login` | 5 / 15 min | **Exists** |
| Per-IP daily cap on `/auth/pin/login` | 30 / 24 h | New |
| Per-account lockout with **doubling backoff** | After 5 failures: 15 min → 30 min → 1 h → … capped at 24 h. A success resets the level. New `user_pins.lock_level` | New (replaces the fixed 15 min) |
| **Owner unlock** | Care Team → caregiver → "Buka kunci" clears the lock and resets `lock_level` (`POST /workspaces/{ws}/members/{id}/pin-unlock`). Audit-logged | New |
| **Owner alert on lock** | In-app notification when a caregiver account locks: "Ada percobaan masuk gagal ke akun Bu Sari." | New |
| **New-device alert** | §5.3 | New |
| Same response for unknown identifier and wrong PIN | Keeps the current behaviour, which doesn't reveal whether an account exists | Exists |
| Common-PIN blocklist | §5.4 | New |
| Owner password login | Per-IP 10 / 15 min, plus per-account lockout with the same doubling backoff, capped at 24 h (D7), on `user_passwords`. Unlock by super-admin, or a successful admin reset clears it. Applies whether the identifier was an email or a phone | New |

**Why this is enough:** an attacker using many IPs is still held back by the **per-account** lock. With the doubling backoff, after the first few locks each account allows at most about 5 guesses a day. Guessing a random PIN with 50% odds would take on the order of **centuries**. The owner is alerted early either way, and the owner unlock prevents a malicious lockout from keeping a caregiver out of their shift.

**Remaining risk, accepted:** someone who learns a caregiver's PIN (for example, watching them type it) can sign in from anywhere. The new-device alert and the owner's revoke and unlock controls are the mitigation. This is the tradeoff D4 chose.

---

## 7. Login screen

- **`/[locale]/login` asks one question first**, with two large cards (≥ 96 px tall, icon + label):
  - **"Saya Pengasuh"**, for caregivers
  - **"Saya Orang Tua / Keluarga"**, for owners
- The last choice is remembered in `localStorage` (`carelog.loginRole`). On a return visit that form opens directly, with a "Bukan Anda? Ganti" link back to the choice.
- **Caregiver form:** "Nomor HP atau nama pengguna" (one input, `autocomplete="username"`), then the existing `PinPad`, then **Masuk**. Below it: "Lupa PIN?", which runs the existing owner-approved flow.
- **Owner form:** "Email atau nomor HP" (one input, `autocomplete="username"`, `inputmode` left as text so `@` stays easy to type), password (`autocomplete="current-password"`, with a show/hide toggle), then **Masuk**. Then **"Masuk dengan Google"**, shown only when configured. Then **"Lupa kata sandi?"** (§4.5) and **"Belum punya akun? Daftar"**.
- **Bu Sari test:** a caregiver signs in with 1 tap (role, skipped when remembered) + identifier + PIN. 16px text, 56px targets, Bahasa Indonesia first. Error copy never reveals whether the account exists: "Nomor/nama pengguna atau PIN salah."
- All strings come from `web/src/messages/{id,en}.json`.

---

## 8. Data model (append-only goose migrations)

```sql
-- user_passwords: mirrors user_pins so owners and caregivers share the
-- lockout mechanics.
CREATE TABLE user_passwords (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,              -- argon2id PHC string
    must_change   BOOLEAN NOT NULL DEFAULT false,
    failed_count  INT NOT NULL DEFAULT 0,
    lock_level    INT NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD CONSTRAINT users_username_format
    CHECK (username IS NULL OR (username ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$'
                                AND username ~ '[a-z]'));
CREATE UNIQUE INDEX idx_users_username_lower ON users (LOWER(username))
    WHERE username IS NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_identity_present;
ALTER TABLE users ADD CONSTRAINT users_identity_present
    CHECK (email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL);

ALTER TABLE user_pins ADD COLUMN lock_level INT NOT NULL DEFAULT 0;
ALTER TABLE invitations ADD COLUMN username TEXT;
```

The reserved-username list and the common-PIN and common-password lists live in Go (`internal/domain`), not in SQL.

## 9. API changes

| Method & path | Who | Change |
|---|---|---|
| `POST /api/v1/auth/register` | public | **New.** Owner signup: name, email and/or phone, password |
| `POST /api/v1/auth/password/login` | public | **New.** `{identifier, password}`, identifier = email or phone |
| `POST /api/v1/auth/password/change` | signed in | **New.** Needs the current password; clears `must_change` |
| `POST /api/v1/admin/users/{id}/password-reset` | super-admin | **New.** Returns the temporary password once |
| `GET /api/v1/auth/google`, `/google/callback` | public | **New** (AUTH-002) |
| `POST /api/v1/auth/google/link` | signed in | **New.** Link from Settings |
| `POST /api/v1/auth/pin/login` | public | **Changed:** `{identifier, pin}`, no device token |
| `POST /api/v1/auth/pin/forgot` | public | **Changed:** takes an identifier |
| `POST /api/v1/workspaces/{ws}/members/{id}/pin-unlock` | owner | **New** |
| `PATCH /api/v1/workspaces/{ws}/members/{id}` | owner | **Changed:** can set a caregiver's `username` |
| `POST /api/v1/workspaces/{ws}/invitations` | owner | **Changed:** optional `username` |
| `GET /api/v1/usernames/{name}/available` | owner | **New.** For the invite form; rate-limited |
| `POST /api/v1/auth/magic-link`, `GET /auth/verify` | public | **Gated** behind `AUTH_MAGIC_LINK_ENABLED` |

Errors use the existing envelope and `apiError` codes. New codes: `invalid_credentials`, `account_locked`, `password_change_required`, `username_taken`, `username_invalid`, `pin_too_common`, `password_too_common`.

## 10. Rollout (one PR each, in order)

1. **Migration:** the schema in §8. No behaviour change.
2. **Owner password auth:** register, password login, password change, admin reset (API + `/admin` UI), `must_change` screen, `AUTH_MAGIC_LINK_ENABLED` gate. E2E helper moves to password sign-in.
3. **Caregiver identifier + any-device PIN:** username on invite and Care Team, `{identifier, pin}` login, the §6 hardening (doubling backoff, daily IP cap, owner unlock, lock and new-device alerts), PIN blocklist.
4. **Login screen revamp:** role choice and the two forms (§7).
5. **Google sign-in:** after the OAuth client exists (§4.4).
6. **Docs:** PRD AUTH-001/002/005 and §17.1, RFC §6.6 (limits table) and §8. These could also land with PR 2 if you'd rather keep docs in step.

## 11. Testing

- **Go:** table-driven tests (testify/require) for:
  - username validation and the phone-vs-username decision;
  - argon2id password verify and the dummy-verify timing path;
  - the backoff schedule (5 → 15m, 30m, 1h … 24h cap) and reset on success;
  - the common-PIN and common-password blocklists;
  - Google account matching rules 1–4;
  - admin reset revoking sessions and setting `must_change`.
- **Handlers:** `httptest` through the middleware: same response for unknown versus wrong credentials, per-IP limits, owner-only unlock, super-admin-only reset.
- **E2E (`scripts/`):** owner register → approve → password login **by email and by phone**; admin reset → forced change; caregiver invite with username → claim → login by username **from a second browser context** (proves any-device) → owner gets the new-device notification; 5 wrong PINs → locked → owner unlock.

## 12. Resolved questions (2026-11-22)

1. **Support WhatsApp number:** the **platform owner's** number, set in `SUPPORT_WHATSAPP` (D5). The platform owner also performs admin resets.
2. **Google OAuth client:** the platform owner creates it **later**. PR 5 waits for it; until then the Google button stays hidden.
3. **Username changes:** **yes**, the caregiver gets an in-app notification (D6, §5.2).
4. **Owners logging in with a phone number:** **yes**. Owners use email **or** phone + password (D1, §4.1–4.2, §7).
5. **24-hour backoff cap:** **yes** (D7).
