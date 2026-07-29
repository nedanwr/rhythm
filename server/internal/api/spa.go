package api

import (
	"bytes"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/nedanwr/rhythm/server/internal/webui"
)

// startTime stands in as the embedded client's modification time. Embedded files
// carry the zero time, which defeats conditional requests; this changes whenever
// a new binary is deployed.
var startTime = time.Now()

// spaHandler serves the embedded client, falling back to index.html so
// client-side routes survive a refresh or a deep link.
func (s *Server) spaHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if !s.uiBuilt {
			s.serveIndex(w, req)
			return
		}
		name := strings.TrimPrefix(path.Clean(req.URL.Path), "/")
		if name == "" || name == "." {
			s.serveIndex(w, req)
			return
		}
		f, err := s.ui.Open(name)
		if err != nil {
			// A missing build artifact is a 404, not the shell: HTML in place of
			// a script turns a broken build into a baffling runtime error.
			if isAssetPath(name) {
				writeError(w, http.StatusNotFound, "not found")
				return
			}
			s.serveIndex(w, req)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || info.IsDir() {
			s.serveIndex(w, req)
			return
		}
		seeker, ok := f.(io.ReadSeeker)
		if !ok {
			s.serveIndex(w, req)
			return
		}
		// Vite fingerprints everything under assets/, so those are immutable.
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeContent(w, req, path.Base(name), startTime, seeker)
	})
}

func (s *Server) serveIndex(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Never cache the shell: it names the hashed bundles, and a stale copy
	// points at files that no longer exist.
	w.Header().Set("Cache-Control", "no-store")

	if !s.uiBuilt {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(webui.PlaceholderIndex())
		return
	}
	data, err := fs.ReadFile(s.ui, "index.html")
	if err != nil {
		s.log.Error("reading embedded index.html", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	http.ServeContent(w, req, "index.html", startTime, bytes.NewReader(data))
}

// assetExtensions are what a browser requests as subresources. One of these
// missing from the build is a genuine 404.
var assetExtensions = map[string]struct{}{
	".js": {}, ".mjs": {}, ".css": {}, ".map": {}, ".json": {},
	".png": {}, ".jpg": {}, ".jpeg": {}, ".gif": {}, ".svg": {}, ".webp": {}, ".avif": {},
	".ico": {}, ".woff": {}, ".woff2": {}, ".ttf": {}, ".otf": {}, ".wasm": {}, ".txt": {},
}

func isAssetPath(name string) bool {
	if strings.HasPrefix(name, "assets/") {
		return true
	}
	_, ok := assetExtensions[strings.ToLower(path.Ext(name))]
	return ok
}
