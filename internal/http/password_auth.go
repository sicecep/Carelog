package http

import (
	"encoding/json"
	"net/http"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/response"
	"github.com/sicecep/carelog/internal/service"
)

// Owner email/phone + password endpoints (login revamp D1/D2).
// Design: docs/superpowers/specs/2026-11-22-login-revamp-design.md §4.

// passwordLoginIPMax is the per-IP budget for POST /auth/password/login per
// 15 minutes. It MUST stay above service.PasswordMaxAttempts, or the IP limit
// always fires first and the per-account lockout becomes unreachable (the
// bug pinLoginIPMax documents). Guarded by
// TestPasswordLoginLimits_IPBudgetExceedsAccountLockout.
const passwordLoginIPMax int64 = 20

// RegisterRequest is the body for POST /auth/register.
type RegisterRequest struct {
	FullName string `json:"full_name"`
	Email    string `json:"email,omitempty"`
	Phone    string `json:"phone,omitempty"`
	Password string `json:"password"`
	Locale   string `json:"locale,omitempty"`
}

// RegisterResponse is identical for a new account and an already-registered
// email or phone, so the endpoint cannot be used to discover accounts.
type RegisterResponse struct {
	Status string `json:"status"` // always "pending_approval"
}

// handleRegister handles POST /auth/register: owner self-registration with a
// password. The account starts pending; a super-admin approves it.
func (h *AuthHandlers) handleRegister(w http.ResponseWriter, r *http.Request) error {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if _, err := h.PasswordSvc.RegisterOwner(r.Context(), service.RegisterOwnerInput{
		FullName: req.FullName,
		Email:    req.Email,
		Phone:    req.Phone,
		Password: req.Password,
		Locale:   req.Locale,
	}); err != nil {
		return err
	}
	response.Created(w, ptr(RegisterResponse{Status: "pending_approval"}))
	return nil
}

// PasswordLoginRequest is the body for POST /auth/password/login.
type PasswordLoginRequest struct {
	// Identifier is an email or a phone number (spec §4.2).
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

// PasswordLoginResponse tells the web app where to go next.
//
//	status "ok"       — session cookies are set; go to Next (or the
//	                    change-password screen when PasswordChangeRequired)
//	status "pending"  — awaiting approval; no session
//	status "rejected" — signup was rejected; no session
type PasswordLoginResponse struct {
	Status                 string `json:"status"`
	Next                   string `json:"next,omitempty"`
	PasswordChangeRequired bool   `json:"password_change_required"`
}

// handlePasswordLogin handles POST /auth/password/login.
func (h *AuthHandlers) handlePasswordLogin(w http.ResponseWriter, r *http.Request) error {
	var req PasswordLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.Identifier == "" || req.Password == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "identifier", Message: "email/phone and password are required"}}}
	}

	user, mustChange, err := h.PasswordSvc.VerifyPasswordLogin(r.Context(), req.Identifier, req.Password)
	if err != nil {
		return err // typed service errors carry their own status and code
	}

	user = h.reconcileSuperAdmin(r.Context(), user)

	if !user.IsActive {
		response.Err(w, "account_disabled", "This account has been deactivated.", http.StatusForbidden)
		return nil
	}
	// Same gate as magic-link verify: no session until approved. The
	// password was correct, so revealing the status here leaks nothing a
	// stranger could learn.
	if user.ApprovalStatus == "pending" || user.ApprovalStatus == "rejected" {
		OK(w, ptr(PasswordLoginResponse{Status: user.ApprovalStatus}))
		return nil
	}

	if err := h.startSession(w, r, user.ID); err != nil {
		return err
	}

	// First approved login of a self-registered owner: create their first
	// workspace, exactly as magic-link verify does.
	memberships, err := h.Queries.CountWorkspaceMembershipsForUser(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if memberships == 0 {
		if err := h.provisionFirstWorkspace(r.Context(), user); err != nil {
			return err
		}
	}

	next := "/dashboard"
	if !user.OnboardingCompleted {
		next = "/onboarding"
	}
	OK(w, ptr(PasswordLoginResponse{Status: "ok", Next: next, PasswordChangeRequired: mustChange}))
	return nil
}

// PasswordChangeRequest is the body for POST /auth/password/change.
type PasswordChangeRequest struct {
	// CurrentPassword is required when the account already has a password.
	CurrentPassword string `json:"current_password,omitempty"`
	NewPassword     string `json:"new_password"`
}

// handlePasswordChange handles POST /auth/password/change for a signed-in
// user. Keeps the current session and signs out every other one.
func (h *AuthHandlers) handlePasswordChange(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Err(w, "unauthorized", "authentication required", http.StatusUnauthorized)
		return nil
	}
	familyID, _ := middleware.FamilyIDFromContext(r.Context())

	var req PasswordChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.NewPassword == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "new_password", Message: "new password is required"}}}
	}
	if err := h.PasswordSvc.ChangePassword(r.Context(), userID, familyID, req.CurrentPassword, req.NewPassword); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "ok"}))
	return nil
}
