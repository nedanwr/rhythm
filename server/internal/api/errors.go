package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/nedanwr/rhythm/server/internal/library"
)

// ErrorBody is the error shape every /api endpoint returns.
type ErrorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	// The body is server-owned, so an error here means the client went away.
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, ErrorBody{Error: message})
}

// libraryStatus maps library errors to status codes. Messages stay generic so
// a request that escapes the root learns nothing about what is out there.
func libraryStatus(err error) (int, string) {
	switch {
	case errors.Is(err, library.ErrNotFound), errors.Is(err, library.ErrNotFile):
		return http.StatusNotFound, "not found"
	case errors.Is(err, library.ErrInvalidPath):
		return http.StatusBadRequest, "invalid path"
	case errors.Is(err, library.ErrNotDir):
		return http.StatusBadRequest, "not a directory"
	default:
		return http.StatusInternalServerError, "internal error"
	}
}
