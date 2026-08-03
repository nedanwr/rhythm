package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"

	"github.com/nedanwr/rhythm/server/internal/art"
)

// artSizes bounds what a client may ask for. A fixed list, not a free
// number, or one caller could grow the cache by asking for 301, 302, 303...
var artSizes = map[int]struct{}{
	64:  {},
	160: {},
	320: {},
	640: {},
}

// defaultArtSize is used when the request omits one.
const defaultArtSize = 320

// artMaxAge is short because retagging a file changes the answer, and the
// ETag makes revalidating cheap.
const artMaxAge = 300

func (s *Server) handleArt(w http.ResponseWriter, req *http.Request) {
	size := defaultArtSize
	if raw := req.URL.Query().Get("size"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid size")
			return
		}
		if _, ok := artSizes[parsed]; !ok {
			writeError(w, http.StatusBadRequest, "unsupported size")
			return
		}
		size = parsed
	}

	_, abs, err := s.registry.ResolveFile(req.PathValue("id"))
	if err != nil {
		status, msg := libraryStatus(err)
		if status == http.StatusInternalServerError {
			s.log.Error("art resolve failed", "error", err)
		}
		writeError(w, status, msg)
		return
	}

	if s.art == nil {
		writeError(w, http.StatusNotFound, "no artwork")
		return
	}
	data, contentType, err := s.art.Thumbnail(abs, size)
	if err != nil {
		// Normal, not a fault — the client draws a placeholder.
		if errors.Is(err, art.ErrNoArt) {
			writeError(w, http.StatusNotFound, "no artwork")
			return
		}
		s.log.Error("art extract failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	sum := sha256.Sum256(data)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	w.Header().Set("ETag", etag)
	// Not shared-cacheable: this is library content, and accounts are coming.
	w.Header().Set("Cache-Control", "private, max-age="+strconv.Itoa(artMaxAge))
	if match := req.Header.Get("If-None-Match"); match != "" && etagMatches(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	// Tag bytes are untrusted; don't let a browser sniff them as something else.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if req.Method != http.MethodHead {
		// A failed write just means the client went away.
		_, _ = w.Write(data)
	}
}

// etagMatches handles "*", comma-separated lists, and the weak prefix.
func etagMatches(header, etag string) bool {
	for len(header) > 0 {
		// Trim leading separators and spaces.
		i := 0
		for i < len(header) && (header[i] == ' ' || header[i] == '\t' || header[i] == ',') {
			i++
		}
		header = header[i:]
		if header == "" {
			return false
		}
		if header[0] == '*' {
			return true
		}
		end := 0
		for end < len(header) && header[end] != ',' {
			end++
		}
		candidate := header[:end]
		for len(candidate) > 0 && (candidate[len(candidate)-1] == ' ' || candidate[len(candidate)-1] == '\t') {
			candidate = candidate[:len(candidate)-1]
		}
		// Weak comparison: the tag covers the whole resource either way.
		if trimWeak(candidate) == trimWeak(etag) {
			return true
		}
		header = header[end:]
	}
	return false
}

func trimWeak(tag string) string {
	if len(tag) > 2 && tag[0] == 'W' && tag[1] == '/' {
		return tag[2:]
	}
	return tag
}
