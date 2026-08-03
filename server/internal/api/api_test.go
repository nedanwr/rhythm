package api

import (
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/nedanwr/rhythm/server/internal/art"
	"github.com/nedanwr/rhythm/server/internal/library"
)

const flacBytes = "fLaC0123456789abcdefghijklmnopqrstuvwxyz"

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func testUI() fs.FS {
	return fstest.MapFS{
		"index.html":         {Data: []byte("<!doctype html><title>Rhythm</title>")},
		"assets/app-abc.js":  {Data: []byte("console.log('rhythm')")},
		"assets/app-abc.css": {Data: []byte("body{}")},
		"favicon.svg":        {Data: []byte("<svg/>")},
	}
}

// newTestServer builds a server over a fresh temp root, returned so tests can
// add files to it.
func newTestServer(t *testing.T, uiBuilt bool) (http.Handler, *library.Root) {
	t.Helper()
	dir := t.TempDir()
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	root := &library.Root{ID: "default", Name: "Music", Path: resolved}
	reg, err := library.NewRegistry(&library.Library{ID: "default", Name: "Music", Roots: []*library.Root{root}})
	if err != nil {
		t.Fatal(err)
	}
	var ui fs.FS
	if uiBuilt {
		ui = testUI()
	}
	h, err := New(Options{
		Registry: reg,
		Logger:   discardLogger(),
		UI:       ui,
		UIBuilt:  uiBuilt,
		// Outside the music root: browsing must never add files to it.
		ArtCache: &art.Cache{Dir: t.TempDir()},
	})
	if err != nil {
		t.Fatal(err)
	}
	return h, root
}

func writeFile(t *testing.T, root *library.Root, rel, data string) {
	t.Helper()
	abs := filepath.Join(root.Path, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func do(t *testing.T, h http.Handler, method, target string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestBrowseDefaultRoot(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "Artist/Album/01.flac", flacBytes)

	rec := do(t, h, http.MethodGet, "/api/browse", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type = %q", ct)
	}
	var listing library.Listing
	if err := json.Unmarshal(rec.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if listing.RootID != "default" || len(listing.Entries) != 1 || !listing.Entries[0].IsDir {
		t.Fatalf("listing = %+v", listing)
	}
}

func TestBrowseQueryPathAndRoot(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "Ólafur/re:member/01 track.flac", flacBytes)

	rec := do(t, h, http.MethodGet, "/api/browse?root=default&path="+
		"%C3%93lafur%2Fre%3Amember", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	var listing library.Listing
	if err := json.Unmarshal(rec.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 1 || listing.Entries[0].Name != "01 track.flac" {
		t.Fatalf("listing = %+v", listing)
	}
}

func TestBrowseErrorStatuses(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "track.flac", flacBytes)

	cases := map[string]int{
		"/api/browse?root=missing":    http.StatusNotFound,
		"/api/browse?path=nope":       http.StatusNotFound,
		"/api/browse?path=track.flac": http.StatusBadRequest,
		"/api/browse?path=..%2F..":    http.StatusOK, // normalized to the root
	}
	for target, want := range cases {
		rec := do(t, h, http.MethodGet, target, nil)
		if rec.Code != want {
			t.Errorf("GET %s = %d, want %d (%s)", target, rec.Code, want, rec.Body)
		}
	}
}

// A traversal attempt must not leak anything about what is outside the root.
func TestBrowseDoesNotEscapeRoot(t *testing.T) {
	h, _ := newTestServer(t, false)
	rec := do(t, h, http.MethodGet, "/api/browse?path=..%2F..%2F..%2F..%2Fetc", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "etc") {
		t.Errorf("error body leaked the requested path: %s", rec.Body)
	}
}

func TestStreamServesWholeFile(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "Artist/01.flac", flacBytes)

	id := library.FileID("default", "Artist/01.flac")
	rec := do(t, h, http.MethodGet, "/api/stream/"+id, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if got := rec.Body.String(); got != flacBytes {
		t.Errorf("body = %q", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "audio/flac" {
		t.Errorf("content type = %q, want audio/flac", got)
	}
	if got := rec.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("accept-ranges = %q, want bytes", got)
	}
}

// Seeking depends on range support, so assert it directly.
func TestStreamRangeRequests(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "01.flac", flacBytes)
	id := library.FileID("default", "01.flac")

	rec := do(t, h, http.MethodGet, "/api/stream/"+id, map[string]string{"Range": "bytes=4-9"})
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", rec.Code)
	}
	if got := rec.Body.String(); got != flacBytes[4:10] {
		t.Errorf("body = %q, want %q", got, flacBytes[4:10])
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 4-9/40" {
		t.Errorf("content-range = %q", got)
	}

	// What a browser sends when it seeks.
	rec = do(t, h, http.MethodGet, "/api/stream/"+id, map[string]string{"Range": "bytes=30-"})
	if rec.Code != http.StatusPartialContent || rec.Body.String() != flacBytes[30:] {
		t.Errorf("open-ended range: status = %d, body = %q", rec.Code, rec.Body)
	}

	// Refuse an unsatisfiable range rather than serving the whole file.
	rec = do(t, h, http.MethodGet, "/api/stream/"+id, map[string]string{"Range": "bytes=9999-"})
	if rec.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Errorf("unsatisfiable range status = %d, want 416", rec.Code)
	}
}

func TestStreamHeadRequest(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "01.flac", flacBytes)

	rec := do(t, h, http.MethodHead, "/api/stream/"+library.FileID("default", "01.flac"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Length"); got != "40" {
		t.Errorf("content-length = %q, want 40", got)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("HEAD returned a body of %d bytes", rec.Body.Len())
	}
}

func TestStreamErrorStatuses(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "cover.jpg", "jpeg")

	cases := map[string]int{
		"/api/stream/" + library.FileID("default", "missing.flac"): http.StatusNotFound,
		"/api/stream/" + library.FileID("default", "cover.jpg"):    http.StatusNotFound,
		"/api/stream/" + library.FileID("other", "01.flac"):        http.StatusNotFound,
		"/api/stream/not-an-id":                                    http.StatusBadRequest,
	}
	for target, want := range cases {
		rec := do(t, h, http.MethodGet, target, nil)
		if rec.Code != want {
			t.Errorf("GET %s = %d, want %d", target, rec.Code, want)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("GET %s content type = %q, want JSON", target, ct)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	h, _ := newTestServer(t, false)
	rec := do(t, h, http.MethodPost, "/api/browse", nil)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}

func TestUnknownAPIPathIsJSON404(t *testing.T) {
	h, _ := newTestServer(t, true)
	rec := do(t, h, http.MethodGet, "/api/nope", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type = %q, want JSON — the SPA must never answer for /api", ct)
	}
}

func TestRootsEndpoint(t *testing.T) {
	h, _ := newTestServer(t, false)
	rec := do(t, h, http.MethodGet, "/api/roots", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body RootsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Libraries) != 1 || len(body.Libraries[0].Roots) != 1 {
		t.Fatalf("body = %+v", body)
	}
	if body.Libraries[0].Roots[0].ID != "default" {
		t.Errorf("root id = %q", body.Libraries[0].Roots[0].ID)
	}
}

func TestSPAFallback(t *testing.T) {
	h, _ := newTestServer(t, true)

	// Deep routes must survive a refresh.
	for _, target := range []string{"/", "/browse/Artist/Album", "/settings"} {
		rec := do(t, h, http.MethodGet, target, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d", target, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "<title>Rhythm</title>") {
			t.Errorf("GET %s did not serve the shell: %s", target, rec.Body)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Errorf("GET %s content type = %q", target, ct)
		}
	}
}

func TestSPAServesRealAssets(t *testing.T) {
	h, _ := newTestServer(t, true)

	rec := do(t, h, http.MethodGet, "/assets/app-abc.js", nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "console.log('rhythm')" {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body)
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("hashed asset cache-control = %q", cc)
	}

	rec = do(t, h, http.MethodGet, "/favicon.svg", nil)
	if rec.Code != http.StatusOK {
		t.Errorf("favicon status = %d", rec.Code)
	}
}

// A missing bundle should fail loudly, not be masked by the HTML shell.
func TestSPAMissingAssetIs404(t *testing.T) {
	h, _ := newTestServer(t, true)
	for _, target := range []string{"/assets/gone.js", "/missing.css", "/logo.png"} {
		rec := do(t, h, http.MethodGet, target, nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", target, rec.Code)
		}
	}
}

func TestSPAPlaceholderWhenUINotBuilt(t *testing.T) {
	h, _ := newTestServer(t, false)
	rec := do(t, h, http.MethodGet, "/", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "No web client is embedded") {
		t.Errorf("body = %s", rec.Body)
	}
}

func TestIndexIsNotCached(t *testing.T) {
	h, _ := newTestServer(t, true)
	rec := do(t, h, http.MethodGet, "/", nil)
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("index cache-control = %q, want no-store", cc)
	}
}

// The logging wrapper must not hide the writer from http.ResponseController.
func TestMiddlewareDoesNotBlockResponseController(t *testing.T) {
	var flushed bool
	h := Chain(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if err := http.NewResponseController(w).Flush(); err == nil {
			flushed = true
		}
		w.WriteHeader(http.StatusNoContent)
	}), Recoverer(discardLogger()), Logger(discardLogger()))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if !flushed {
		t.Error("ResponseController could not reach the underlying writer")
	}
}

// A panic should become a 500, not a dropped connection.
func TestRecovererTurnsPanicIntoError(t *testing.T) {
	h := Chain(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}), Recoverer(discardLogger()))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "internal error") {
		t.Errorf("body = %s", rec.Body)
	}
}
