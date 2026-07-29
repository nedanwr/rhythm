// Package api wires Rhythm's HTTP surface: the JSON API, byte streaming, and the SPA fallback that serves the embedded web client.
package api

import (
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/nedanwr/rhythm/server/internal/library"
	"github.com/nedanwr/rhythm/server/internal/stream"
)

// Server holds the dependencies shared by every handler.
type Server struct {
	registry *library.Registry
	log      *slog.Logger
	ui       fs.FS
	uiBuilt  bool
}

// Options configures a Server.
type Options struct {
	Registry *library.Registry
	Logger   *slog.Logger
	// UI is the embedded client. When UIBuilt is false a placeholder is served.
	UI      fs.FS
	UIBuilt bool
}

// New builds the server's handler tree.
func New(opts Options) (http.Handler, error) {
	if opts.Registry == nil {
		return nil, errors.New("api: registry is required")
	}
	log := opts.Logger
	if log == nil {
		log = slog.New(slog.NewTextHandler(os.Stderr, nil))
	}
	s := &Server{registry: opts.Registry, log: log, ui: opts.UI, uiBuilt: opts.UIBuilt}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/roots", s.handleRoots)
	mux.HandleFunc("GET /api/browse", s.handleBrowse)
	mux.HandleFunc("GET /api/stream/{id}", s.handleStream)
	// Any other /api path is an API error, never the SPA shell: a wrong endpoint
	// should return JSON, not HTML. This pattern also swallows ServeMux's own
	// 405, so a known path with the wrong method is answered here.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, req *http.Request) {
		if isKnownEndpoint(req.URL.Path) {
			w.Header().Set("Allow", "GET, HEAD")
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeError(w, http.StatusNotFound, "unknown endpoint")
	})
	mux.Handle("/", s.spaHandler())

	return Chain(mux, Recoverer(log), Logger(log)), nil
}

// isKnownEndpoint reports whether a path has a registered route. Every endpoint
// is read-only, so a match with any other method is a 405 rather than a 404.
func isKnownEndpoint(path string) bool {
	switch path {
	case "/api/roots", "/api/browse":
		return true
	}
	return strings.HasPrefix(path, "/api/stream/")
}

// RootsResponse lists the libraries and their roots.
type RootsResponse struct {
	Libraries []*library.Library `json:"libraries"`
}

func (s *Server) handleRoots(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, RootsResponse{Libraries: s.registry.Libraries()})
}

func (s *Server) handleBrowse(w http.ResponseWriter, req *http.Request) {
	rootID := req.URL.Query().Get("root")
	if rootID == "" {
		root, err := s.registry.DefaultRoot()
		if err != nil {
			status, msg := libraryStatus(err)
			writeError(w, status, msg)
			return
		}
		rootID = root.ID
	}
	listing, err := s.registry.Browse(rootID, req.URL.Query().Get("path"))
	if err != nil {
		status, msg := libraryStatus(err)
		if status == http.StatusInternalServerError {
			s.log.Error("browse failed", "root", rootID, "error", err)
		}
		writeError(w, status, msg)
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

func (s *Server) handleStream(w http.ResponseWriter, req *http.Request) {
	_, abs, err := s.registry.ResolveFile(req.PathValue("id"))
	if err != nil {
		status, msg := libraryStatus(err)
		if status == http.StatusInternalServerError {
			s.log.Error("stream resolve failed", "error", err)
		}
		writeError(w, status, msg)
		return
	}
	if err := stream.ServeFile(w, req, abs); err != nil {
		// It existed a moment ago, so it was removed or chmod'd under us.
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		s.log.Error("stream failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
