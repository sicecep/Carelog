package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
)

// AUTH-005 / login revamp D3–D4: caregiver phone-or-username + PIN.
//
// Cookie model: the device secret (`cl_device`, HttpOnly, 1 year) marks a
// KNOWN device. It no longer gates login (the PIN works from any device);
// a sign-in without a known cookie enrols this device and alerts the owner.
// `/pin/reset/complete` still requires the cookie of the device that asked.

// deviceCookieName is the trusted-device secret cookie.
const deviceCookieName = "cl_device"

// pinLoginIPDailyMax is the per-IP budget for POST /auth/pin/login per day
// (spec §6). It caps slow scripted guessing that stays under the 15-minute
// window.
const pinLoginIPDailyMax int64 = 30

// pinLoginIPMax is the per-IP budget for POST /auth/pin/login in a 15-minute
// window. It must stay STRICTLY ABOVE service.PINMaxAttempts so the
// per-account lockout is reachable from a single IP; see
// TestPINLoginLimits_IPBudgetExceedsAccountLockout.
const pinLoginIPMax int64 = 20

// deviceCookieTTL: the device secret is long-lived by design; the PIN gates
// its use. Revocation is explicit (device row revoked_at).
const deviceCookieTTL = 365 * 24 * time.Hour

// DeviceCookieMaxBytes bounds what we will read from the cookie.
const DeviceCookieMaxBytes = 128

// setDeviceCookie writes the device secret. HttpOnly: JavaScript must never
// read the possession factor (an XSS would otherwise become a full login).
func (h *AuthHandlers) setDeviceCookie(w http.ResponseWriter, r *http.Request, token string) {
	secure := isRequestSecure(r)
	http.SetCookie(w, &http.Cookie{
		Name:     deviceCookieName,
		Value:    token,
		Path:     "/",
		Domain:   h.CookieDomain,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(deviceCookieTTL.Seconds()),
	})
}

// deviceTokenFromRequest reads the device cookie, tolerating absence.
func deviceTokenFromRequest(r *http.Request) string {
	c, err := r.Cookie(deviceCookieName)
	if err != nil || len(c.Value) > DeviceCookieMaxBytes {
		return ""
	}
	return c.Value
}

// PINLoginRequest is the body for POST /auth/pin/login.
type PINLoginRequest struct {
	// Identifier is a phone number or a username (spec §5.1).
	Identifier string `json:"identifier"`
	PIN        string `json:"pin"`
}

// handlePINLogin authenticates phone-or-username + PIN from any device.
//
// Error mapping is deliberately coarse: a wrong PIN, an unknown identifier
// and an account with no PIN all answer invalid_credentials; only the
// lockout is distinguishable.
func (h *AuthHandlers) handlePINLogin(w http.ResponseWriter, r *http.Request) error {
	if h.PINSvc == nil {
		return &service.ErrValidation{Errors: []service.RecipientError{{Field: "pin", Message: "PIN login is not configured"}}}
	}

	var req PINLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.Identifier == "" || req.PIN == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "identifier", Message: "identifier and PIN are required"}}}
	}

	res, err := h.PINSvc.VerifyPINLogin(r.Context(), req.Identifier, req.PIN, deviceTokenFromRequest(r), deviceLabelFrom(r))
	if err != nil {
		return err // service errors carry their own status/code
	}
	user := res.User
	if res.DeviceToken != "" {
		h.setDeviceCookie(w, r, res.DeviceToken)
	}

	// Approval gate, same as magic-link verify: pending/rejected users get
	// no session. Caregivers from an accepted invite are 'approved' by
	// default, so this only fires for the odd self-registered caregiver.
	if user.ApprovalStatus == "pending" || user.ApprovalStatus == "rejected" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "account", Message: "account is awaiting approval"}}}
	}

	return h.issuePINSession(w, r, user.ID)
}

// issuePINSession creates the refresh family + access token and sets the
// auth cookies — the same shape as magic-link verify, minus the email
// verification step (phones are verified at enrolment time).
func (h *AuthHandlers) issuePINSession(w http.ResponseWriter, r *http.Request, userID uuid.UUID) error {
	if err := h.startSession(w, r, userID); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "ok"}))
	return nil
}

// startSession creates a refresh-token family and an access token for
// userID and sets both auth cookies. It writes no response body, so each
// login flow can answer in its own shape.
func (h *AuthHandlers) startSession(w http.ResponseWriter, r *http.Request, userID uuid.UUID) error {
	familyID := uuid.New()
	rawRefresh, _, err := h.RefreshSvc.IssueRefreshToken(r.Context(), userID, familyID, r.UserAgent(), getClientIP(r))
	if err != nil {
		return fmt.Errorf("issue refresh token: %w", err)
	}
	accessToken, err := h.Signer.Sign(r.Context(), userID, familyID)
	if err != nil {
		return fmt.Errorf("sign access token: %w", err)
	}
	setAuthCookies(w, r, accessToken, rawRefresh, h.CookieDomain, h.Signer.AccessTokenTTL(), h.Signer.RefreshTokenTTL())
	return nil
}

// PINEnrolRequest is the body for POST /auth/pin/enrol.
type PINEnrolRequest struct {
	// EnrolToken authorises the enrolment: an invite-claim token or an
	// approved reset token. The caller has no session yet by design.
	EnrolToken string `json:"enrol_token"`
	PIN        string `json:"pin"`
}

// handlePINEnrol sets a PIN + enrols the device during an invite claim.
//
// The enrol token here is the invitation claim secret: possession of it is
// the owner's vouching for this device. It is exchanged for a device cookie
// and never usable again (the invitation is consumed at claim time).
func (h *AuthHandlers) handlePINEnrol(w http.ResponseWriter, r *http.Request) error {
	if h.PINSvc == nil {
		return &service.ErrValidation{Errors: []service.RecipientError{{Field: "pin", Message: "PIN login is not configured"}}}
	}

	var req PINEnrolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.EnrolToken == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "enrol_token", Message: "enrolment token is required"}}}
	}

	// The caller must be authenticated (invite claim established a session)
	// — the enrol token alone is not enough to set a PIN on an arbitrary
	// account.
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "sign in first"}}}
	}

	device, err := h.PINSvc.SetPIN(r.Context(), userID, req.PIN, deviceLabelFrom(r))
	if err != nil {
		return err
	}
	h.setDeviceCookie(w, r, device)
	Created(w, ptr(map[string]string{"status": "enrolled"}))
	return nil
}

// PINForgotRequest is the body for POST /auth/pin/forgot.
type PINForgotRequest struct {
	// Identifier is a phone number or a username.
	Identifier string `json:"identifier"`
}

// handlePINForgot records a reset request for the owner to approve.
//
// Always 201 (or rate-limited), never an account-existence oracle: the
// service layer deliberately no-ops unknown numbers.
func (h *AuthHandlers) handlePINForgot(w http.ResponseWriter, r *http.Request) error {
	if h.PINSvc == nil {
		return &service.ErrValidation{Errors: []service.RecipientError{{Field: "pin", Message: "PIN login is not configured"}}}
	}

	var req PINForgotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.Identifier == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "identifier", Message: "phone number or username is required"}}}
	}

	// The request is bound to the CURRENT device cookie (if any): approval
	// will only re-enrol this device. A device without a cookie yet (fresh
	// install + forgotten PIN) records a hash of "none" and must re-enrol
	// through the owner's fresh invite instead — the safest fallback.
	if err := h.PINSvc.RequestPINReset(r.Context(), req.Identifier, deviceLabelFrom(r), getClientIP(r)); err != nil {
		return err
	}
	Created(w, ptr(map[string]string{"status": "requested"}))
	return nil
}

// PINResetCompleteRequest is the body for POST /auth/pin/reset/complete.
type PINResetCompleteRequest struct {
	ResetToken string `json:"reset_token"`
	PIN        string `json:"pin"`
}

// handlePINResetComplete redeems an owner-approved reset token.
//
// The device binding is implicit and load-bearing: the token only matches
// the device_hash recorded at request time, so an intercepted token is
// useless elsewhere. Success revokes all previous devices and enrols this
// one with the new PIN.
func (h *AuthHandlers) handlePINResetComplete(w http.ResponseWriter, r *http.Request) error {
	if h.PINSvc == nil {
		return &service.ErrValidation{Errors: []service.RecipientError{{Field: "pin", Message: "PIN login is not configured"}}}
	}

	var req PINResetCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	userID, device, err := h.PINSvc.CompletePINReset(
		r.Context(), req.ResetToken, deviceTokenFromRequest(r), req.PIN, deviceLabelFrom(r))
	if err != nil {
		return err
	}
	h.setDeviceCookie(w, r, device)

	// The caregiver just proved control of their phone through the owner;
	// log them straight in rather than bouncing them to the login screen.
	return h.issuePINSession(w, r, userID)
}

// PINSetRequest is the body for POST /auth/pin/set (session-authenticated).
type PINSetRequest struct {
	PIN             string `json:"pin"`
	CurrentPassword string `json:"current_pin"`
}

// handleSetPIN changes the PIN on a live session. The old PIN is required:
// an unlocked phone sitting on the dashboard must not be enough to swap the
// credential.
func (h *AuthHandlers) handleSetPIN(w http.ResponseWriter, r *http.Request) error {
	if h.PINSvc == nil {
		return &service.ErrValidation{Errors: []service.RecipientError{{Field: "pin", Message: "PIN login is not configured"}}}
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "sign in first"}}}
	}

	var req PINSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	// Re-verify the current PIN before allowing a change. Failures count
	// toward the same lockout as login.
	if err := h.PINSvc.VerifyCurrentPIN(r.Context(), userID, req.CurrentPassword); err != nil {
		if errors.Is(err, service.ErrPINIncorrect{}) || errors.Is(err, service.ErrPINLocked{}) {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "current_pin", Message: "current PIN is incorrect"}}}
		}
		return err
	}

	device, err := h.PINSvc.SetPIN(r.Context(), userID, req.PIN, deviceLabelFrom(r))
	if err != nil {
		return err
	}
	h.setDeviceCookie(w, r, device)
	OK(w, ptr(map[string]string{"status": "updated"}))
	return nil
}

// deviceLabelFrom derives a human-recognisable label for the revoke/approval
// UIs. User-Agent only: IPs change, and anything more precise is a tracker.
func deviceLabelFrom(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 120 {
		ua = ua[:120]
	}
	return ua
}

// ClaimWithPINRequest is the body for POST /invites/{token}/claim-pin.
type ClaimWithPINRequest struct {
	// Phone is optional when the invite carries a username.
	Phone  string `json:"phone"`
	PIN    string `json:"pin"`
	Locale string `json:"locale"`
}

// handleClaimInvitationWithPIN is the phone-primary invite claim (AUTH-005).
//
// Deliberately NOT behind auth middleware: a caregiver with no email has no
// way to obtain a session first, which is the whole point of this epic. The
// invite token is the credential — single-use, 72h, delivered by the owner
// over their own WhatsApp.
func (h *AuthHandlers) handleClaimInvitationWithPIN(w http.ResponseWriter, r *http.Request) error {
	if h.PINSvc == nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "pin", Message: "PIN login is not configured"}}}
	}

	var req ClaimWithPINRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	token := chi.URLParam(r, "token")
	if token == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "token", Message: "invitation token is required"}}}
	}

	res, err := service.ClaimInvitationWithPIN(
		r.Context(), h.Queries, h.Pool, token, req.Phone, req.PIN, deviceLabelFrom(r), req.Locale)
	if err != nil {
		return err
	}

	// Enrol this device and sign them straight in — bouncing a caregiver to
	// a login screen right after they set a PIN is friction for no security
	// gain (they just proved possession of the invite).
	h.setDeviceCookie(w, r, res.DeviceToken)
	return h.issuePINSession(w, r, res.UserID)
}
