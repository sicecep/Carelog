// Package response provides shared HTTP response helpers.
package response

import (
	"encoding/json"
	"net/http"
)

// Envelope is the standard JSON response shape used by all API endpoints.
//
// Data is present on success (HTTP 2xx). Error is present on failure (HTTP 4xx/5xx).
// Meta is present on paginated list responses.
type Envelope[T any] struct {
	Data  *T        `json:"data,omitempty"`
	Error *APIError `json:"error,omitempty"`
	Meta  *Meta     `json:"meta,omitempty"`
}

// APIError is the machine-readable error payload.
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}

// Meta carries pagination info for list responses.
type Meta struct {
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
	Total    int `json:"total"`
}

// Respond writes an Envelope as JSON with the given HTTP status.
func Respond[T any](w http.ResponseWriter, status int, data *T, err *APIError, meta *Meta) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Envelope[T]{Data: data, Error: err, Meta: meta})
}

// OK writes a 200 response with data.
func OK[T any](w http.ResponseWriter, data *T) {
	Respond(w, http.StatusOK, data, nil, nil)
}

// Created writes a 201 response with data.
func Created[T any](w http.ResponseWriter, data *T) {
	Respond(w, http.StatusCreated, data, nil, nil)
}

// Err writes an error response with the given status code.
func Err(w http.ResponseWriter, code, message string, status int) {
	Respond[any](w, status, nil, &APIError{Code: code, Message: message, Status: status}, nil)
}