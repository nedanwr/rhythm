package api

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/nedanwr/rhythm/server/internal/library"
)

// jpegFixture encodes a solid square so tests can assert on dimensions.
func jpegFixture(t *testing.T, size int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// flacWithPicture builds the smallest FLAC the extractor accepts: magic
// plus one PICTURE block.
func flacWithPicture(t *testing.T, picture []byte) []byte {
	t.Helper()
	var block bytes.Buffer
	write32 := func(v uint32) {
		_ = binary.Write(&block, binary.BigEndian, v)
	}
	write32(3) // picture type: front cover
	mime := "image/jpeg"
	write32(uint32(len(mime)))
	block.WriteString(mime)
	write32(0) // empty description
	for range 4 {
		write32(0) // width, height, depth, colours
	}
	write32(uint32(len(picture)))
	block.Write(picture)

	var out bytes.Buffer
	out.WriteString("fLaC")
	body := block.Bytes()
	// Last-block flag, type 6 (PICTURE), 24-bit big-endian length.
	out.WriteByte(0x80 | 6)
	out.Write([]byte{byte(len(body) >> 16), byte(len(body) >> 8), byte(len(body))})
	out.Write(body)
	return out.Bytes()
}

func writeBinary(t *testing.T, root *library.Root, rel string, data []byte) {
	t.Helper()
	abs := filepath.Join(root.Path, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func decodeDimensions(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding response body: %v", err)
	}
	return cfg.Width, cfg.Height
}

func TestArtServesEmbeddedPicture(t *testing.T) {
	h, root := newTestServer(t, false)
	writeBinary(t, root, "Artist/Album/01.flac", flacWithPicture(t, jpegFixture(t, 500, color.RGBA{200, 80, 40, 255})))

	id := library.FileID("default", "Artist/Album/01.flac")
	rec := do(t, h, http.MethodGet, "/api/art/"+id, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("content type = %q", ct)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("nosniff = %q", got)
	}
	// Default bound is 320, so a 500px source scales down.
	if w, hgt := decodeDimensions(t, rec.Body.Bytes()); w != defaultArtSize || hgt != defaultArtSize {
		t.Errorf("dimensions = %dx%d, want %d square", w, hgt, defaultArtSize)
	}
}

// No embedded picture, but a cover sitting beside it.
func TestArtFallsBackToFolderImage(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "Artist/Album/01.flac", flacBytes)
	writeBinary(t, root, "Artist/Album/cover.jpg", jpegFixture(t, 400, color.RGBA{20, 120, 200, 255}))

	id := library.FileID("default", "Artist/Album/01.flac")
	rec := do(t, h, http.MethodGet, "/api/art/"+id+"?size=160", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if w, hgt := decodeDimensions(t, rec.Body.Bytes()); w != 160 || hgt != 160 {
		t.Errorf("dimensions = %dx%d, want 160 square", w, hgt)
	}
}

// No art at all is ordinary: a clean 404, not a 500 or an empty 200.
func TestArtMissingIsNotFound(t *testing.T) {
	h, root := newTestServer(t, false)
	writeFile(t, root, "Artist/Album/01.flac", flacBytes)

	rec := do(t, h, http.MethodGet, "/api/art/"+library.FileID("default", "Artist/Album/01.flac"), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type = %q, want JSON", ct)
	}
}

// An open size range would let one caller multiply the cache.
func TestArtRejectsUnsupportedSizes(t *testing.T) {
	h, root := newTestServer(t, false)
	writeBinary(t, root, "01.flac", flacWithPicture(t, jpegFixture(t, 200, color.RGBA{1, 2, 3, 255})))
	id := library.FileID("default", "01.flac")

	for _, size := range []string{"0", "321", "-1", "99999", "abc", "160.0"} {
		rec := do(t, h, http.MethodGet, "/api/art/"+id+"?size="+size, nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("size=%s => %d, want 400", size, rec.Code)
		}
	}
	for size := range artSizes {
		rec := do(t, h, http.MethodGet, "/api/art/"+id+"?size="+strconv.Itoa(size), nil)
		if rec.Code != http.StatusOK {
			t.Errorf("size=%d => %d, want 200", size, rec.Code)
		}
	}
}

func TestArtRevalidatesWithETag(t *testing.T) {
	h, root := newTestServer(t, false)
	writeBinary(t, root, "01.flac", flacWithPicture(t, jpegFixture(t, 400, color.RGBA{9, 9, 9, 255})))
	id := library.FileID("default", "01.flac")

	first := do(t, h, http.MethodGet, "/api/art/"+id, nil)
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag on the first response")
	}
	if cc := first.Header().Get("Cache-Control"); !strings.Contains(cc, "private") {
		t.Errorf("cache-control = %q, want private", cc)
	}

	second := do(t, h, http.MethodGet, "/api/art/"+id, map[string]string{"If-None-Match": etag})
	if second.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304", second.Code)
	}
	if second.Body.Len() != 0 {
		t.Errorf("304 carried %d bytes", second.Body.Len())
	}

	// A stale tag must still get the image.
	third := do(t, h, http.MethodGet, "/api/art/"+id, map[string]string{"If-None-Match": `"stale"`})
	if third.Code != http.StatusOK {
		t.Errorf("stale tag => %d, want 200", third.Code)
	}
}

func TestArtETagMatchingHandlesListsAndWildcards(t *testing.T) {
	tag := `"abc123"`
	matching := []string{tag, `W/"abc123"`, `"other", "abc123"`, `*`, ` "abc123" `}
	for _, header := range matching {
		if !etagMatches(header, tag) {
			t.Errorf("If-None-Match %q should match %s", header, tag)
		}
	}
	for _, header := range []string{`"nope"`, `"a", "b"`, ``, `"abc123x"`} {
		if etagMatches(header, tag) {
			t.Errorf("If-None-Match %q should not match %s", header, tag)
		}
	}
}

func TestArtHeadOmitsBody(t *testing.T) {
	h, root := newTestServer(t, false)
	writeBinary(t, root, "01.flac", flacWithPicture(t, jpegFixture(t, 400, color.RGBA{4, 4, 4, 255})))

	rec := do(t, h, http.MethodHead, "/api/art/"+library.FileID("default", "01.flac"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("HEAD returned %d bytes", rec.Body.Len())
	}
	if rec.Header().Get("Content-Length") == "" {
		t.Error("HEAD gave no Content-Length")
	}
}

// Same id resolution as streaming, so the same escapes must fail.
func TestArtErrorStatuses(t *testing.T) {
	h, root := newTestServer(t, false)
	writeBinary(t, root, "cover.jpg", jpegFixture(t, 64, color.RGBA{7, 7, 7, 255}))

	cases := map[string]int{
		"/api/art/" + library.FileID("default", "missing.flac"): http.StatusNotFound,
		"/api/art/" + library.FileID("default", "cover.jpg"):    http.StatusNotFound,
		"/api/art/" + library.FileID("default", "../secret"):    http.StatusNotFound,
		"/api/art/" + library.FileID("other", "01.flac"):        http.StatusNotFound,
		"/api/art/not-an-id": http.StatusBadRequest,
	}
	for target, want := range cases {
		rec := do(t, h, http.MethodGet, target, nil)
		if rec.Code != want {
			t.Errorf("GET %s = %d, want %d (%s)", target, rec.Code, want, rec.Body)
		}
	}
}

func TestArtWrongMethodIsJSON405(t *testing.T) {
	h, _ := newTestServer(t, true)
	rec := do(t, h, http.MethodPost, "/api/art/"+library.FileID("default", "01.flac"), nil)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type = %q, want JSON", ct)
	}
}

// No cache still runs; artwork just reports absent.
func TestArtWithoutCacheIsNotFound(t *testing.T) {
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
	h, err := New(Options{Registry: reg, Logger: discardLogger()})
	if err != nil {
		t.Fatal(err)
	}
	writeBinary(t, root, "01.flac", flacWithPicture(t, jpegFixture(t, 200, color.RGBA{5, 5, 5, 255})))

	rec := do(t, h, http.MethodGet, "/api/art/"+library.FileID("default", "01.flac"), nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
