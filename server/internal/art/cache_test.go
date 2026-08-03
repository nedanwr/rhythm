package art

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// --- fixtures ---

func pngBytes(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func jpegBytes(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

// writeMP3 writes a minimal ID3v2.3 tag with one APIC frame, plus filler
// standing in for audio.
func writeMP3(t *testing.T, path, mime string, picture []byte) {
	t.Helper()
	var frame bytes.Buffer
	frame.WriteByte(0)      // latin1 text encoding
	frame.WriteString(mime) // MIME type
	frame.WriteByte(0)      // terminator
	frame.WriteByte(3)      // picture type: front cover
	frame.WriteByte(0)      // empty description + terminator
	frame.Write(picture)    //
	body := frame.Bytes()   //
	var tag bytes.Buffer    //
	tag.WriteString("APIC") //
	_ = binary.Write(&tag, binary.BigEndian, uint32(len(body)))
	tag.Write([]byte{0, 0}) // frame flags
	tag.Write(body)

	size := tag.Len()
	var out bytes.Buffer
	out.WriteString("ID3")
	out.Write([]byte{3, 0, 0}) // v2.3, revision 0, no flags
	out.Write([]byte{
		byte(size >> 21 & 0x7f), byte(size >> 14 & 0x7f),
		byte(size >> 7 & 0x7f), byte(size & 0x7f),
	})
	out.Write(tag.Bytes())
	out.Write(bytes.Repeat([]byte{0xff}, 64)) // filler "audio"

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		t.Fatalf("write mp3: %v", err)
	}
}

// writeSilentMP3 has no embedded picture, so Extract falls through to the
// folder image.
func writeSilentMP3(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, bytes.Repeat([]byte{0xff}, 128), 0o644); err != nil {
		t.Fatalf("write mp3: %v", err)
	}
}

// touchNewer backdates the other inputs so a rewrite is visible even with
// coarse timestamps.
func touchNewer(t *testing.T, path string) {
	t.Helper()
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
}

func decodeSize(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode config: %v", err)
	}
	return cfg.Width, cfg.Height
}

func tmpFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			names = append(names, e.Name())
		}
	}
	return names
}

// --- tests ---

// Two roots can hold the same relative album path and must not share an
// entry; the key is the absolute path for exactly this reason.
func TestThumbnailDistinguishesIdenticalRelativePathsInDifferentRoots(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}

	red := pngBytes(t, 8, 8, color.RGBA{R: 255, A: 255})
	blue := pngBytes(t, 8, 8, color.RGBA{B: 255, A: 255})
	a := filepath.Join(base, "rootA", "Album", "track.mp3")
	b := filepath.Join(base, "rootB", "Album", "track.mp3")
	writeMP3(t, a, "image/png", red)
	writeMP3(t, b, "image/png", blue)

	gotA, _, err := cache.Thumbnail(a, 0)
	if err != nil {
		t.Fatalf("thumbnail A: %v", err)
	}
	gotB, _, err := cache.Thumbnail(b, 0)
	if err != nil {
		t.Fatalf("thumbnail B: %v", err)
	}
	if !bytes.Equal(gotA, red) {
		t.Error("root A did not return its own artwork")
	}
	if !bytes.Equal(gotB, blue) {
		t.Error("root B was served root A's artwork")
	}
}

// Tracks in one album can carry different pictures, so the key is per
// file, not per directory.
func TestThumbnailKeysPerFileNotPerDirectory(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}

	one := pngBytes(t, 8, 8, color.RGBA{R: 255, A: 255})
	two := pngBytes(t, 8, 8, color.RGBA{G: 255, A: 255})
	a := filepath.Join(base, "Album", "01.mp3")
	b := filepath.Join(base, "Album", "02.mp3")
	writeMP3(t, a, "image/png", one)
	writeMP3(t, b, "image/png", two)

	gotA, _, err := cache.Thumbnail(a, 0)
	if err != nil {
		t.Fatalf("thumbnail 01: %v", err)
	}
	gotB, _, err := cache.Thumbnail(b, 0)
	if err != nil {
		t.Fatalf("thumbnail 02: %v", err)
	}
	if bytes.Equal(gotA, gotB) {
		t.Error("two tracks with different embedded art shared one cache entry")
	}
}

func TestThumbnailInvalidatesWhenEmbeddedArtChanges(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	track := filepath.Join(base, "Album", "track.mp3")

	before := pngBytes(t, 8, 8, color.RGBA{R: 255, A: 255})
	writeMP3(t, track, "image/png", before)
	if got, _, err := cache.Thumbnail(track, 0); err != nil || !bytes.Equal(got, before) {
		t.Fatalf("first read: got %d bytes, err %v", len(got), err)
	}

	after := pngBytes(t, 16, 16, color.RGBA{B: 255, A: 255})
	writeMP3(t, track, "image/png", after)
	touchNewer(t, track)

	got, _, err := cache.Thumbnail(track, 0)
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if !bytes.Equal(got, after) {
		t.Error("replaced embedded artwork still served the stale cache entry")
	}
}

func TestThumbnailInvalidatesWhenFolderImageChanges(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	dir := filepath.Join(base, "Album")
	track := filepath.Join(dir, "track.mp3")
	cover := filepath.Join(dir, "cover.png")
	writeSilentMP3(t, track)

	before := pngBytes(t, 8, 8, color.RGBA{R: 255, A: 255})
	if err := os.WriteFile(cover, before, 0o644); err != nil {
		t.Fatalf("write cover: %v", err)
	}
	if got, _, err := cache.Thumbnail(track, 0); err != nil || !bytes.Equal(got, before) {
		t.Fatalf("first read: got %d bytes, err %v", len(got), err)
	}

	after := pngBytes(t, 16, 16, color.RGBA{B: 255, A: 255})
	if err := os.WriteFile(cover, after, 0o644); err != nil {
		t.Fatalf("rewrite cover: %v", err)
	}
	touchNewer(t, cover)

	got, _, err := cache.Thumbnail(track, 0)
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if !bytes.Equal(got, after) {
		t.Error("replaced folder artwork still served the stale cache entry")
	}
}

// Dropping a cover next to an artless track must start serving it, not
// keep answering "no artwork".
func TestThumbnailPicksUpNewlyAddedFolderImage(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	dir := filepath.Join(base, "Album")
	track := filepath.Join(dir, "track.mp3")
	writeSilentMP3(t, track)

	if _, _, err := cache.Thumbnail(track, 0); err == nil {
		t.Fatal("expected no artwork before a cover exists")
	}

	cover := pngBytes(t, 8, 8, color.RGBA{G: 255, A: 255})
	if err := os.WriteFile(filepath.Join(dir, "cover.png"), cover, 0o644); err != nil {
		t.Fatalf("write cover: %v", err)
	}
	got, contentType, err := cache.Thumbnail(track, 0)
	if err != nil {
		t.Fatalf("after adding cover: %v", err)
	}
	if !bytes.Equal(got, cover) {
		t.Error("newly added folder artwork was not served")
	}
	if contentType != "image/png" {
		t.Errorf("content type = %q, want image/png", contentType)
	}
}

// Unresized artwork keeps its own type; only a resize makes it JPEG.
func TestThumbnailReportsContentType(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}

	pngTrack := filepath.Join(base, "png", "track.mp3")
	writeMP3(t, pngTrack, "image/png", pngBytes(t, 64, 64, color.RGBA{R: 255, A: 255}))
	jpgTrack := filepath.Join(base, "jpg", "track.mp3")
	writeMP3(t, jpgTrack, "image/jpeg", jpegBytes(t, 64, 64, color.RGBA{R: 255, A: 255}))

	for _, tc := range []struct {
		name, path, want string
		size             int
	}{
		{"raw png", pngTrack, "image/png", 0},
		{"raw jpeg", jpgTrack, "image/jpeg", 0},
		// A resize re-encodes, so the type is JPEG whatever went in.
		{"resized png", pngTrack, "image/jpeg", 32},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, contentType, err := cache.Thumbnail(tc.path, tc.size)
			if err != nil {
				t.Fatalf("thumbnail: %v", err)
			}
			if contentType != tc.want {
				t.Errorf("content type = %q, want %q", contentType, tc.want)
			}
			// Rebuilt from the entry's name, so it must survive a hit.
			cached, cachedType, err := cache.Thumbnail(tc.path, tc.size)
			if err != nil {
				t.Fatalf("cached thumbnail: %v", err)
			}
			if cachedType != tc.want {
				t.Errorf("cached content type = %q, want %q", cachedType, tc.want)
			}
			if !bytes.Equal(cached, data) {
				t.Error("cached bytes differ from the first response")
			}
		})
	}
}

// Unrecognised bytes must not claim to be an image.
func TestThumbnailLabelsUnknownBytesAsBinary(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	track := filepath.Join(base, "Album", "track.mp3")
	writeMP3(t, track, "image/png", []byte("not actually an image at all"))

	_, contentType, err := cache.Thumbnail(track, 0)
	if err != nil {
		t.Fatalf("thumbnail: %v", err)
	}
	if contentType != "application/octet-stream" {
		t.Errorf("content type = %q, want application/octet-stream", contentType)
	}
}

func TestThumbnailResizesToBound(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	track := filepath.Join(base, "Album", "track.mp3")
	writeMP3(t, track, "image/png", pngBytes(t, 200, 100, color.RGBA{R: 255, A: 255}))

	data, _, err := cache.Thumbnail(track, 50)
	if err != nil {
		t.Fatalf("thumbnail: %v", err)
	}
	if w, h := decodeSize(t, data); w != 50 || h != 25 {
		t.Errorf("resized to %dx%d, want 50x25", w, h)
	}
}

// Concurrent misses on one key must not rename a partial file into place.
func TestThumbnailConcurrentMissesProduceOneIntactEntry(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	track := filepath.Join(base, "Album", "track.mp3")
	writeMP3(t, track, "image/png", pngBytes(t, 512, 512, color.RGBA{R: 200, G: 40, A: 255}))

	const workers = 24
	var wg sync.WaitGroup
	results := make([][]byte, workers)
	errs := make([]error, workers)
	start := make(chan struct{})
	for i := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results[i], _, errs[i] = cache.Thumbnail(track, 256)
		}()
	}
	close(start)
	wg.Wait()

	for i := range workers {
		if errs[i] != nil {
			t.Fatalf("worker %d: %v", i, errs[i])
		}
		if !bytes.Equal(results[i], results[0]) {
			t.Fatalf("worker %d returned different bytes", i)
		}
	}
	// Every entry must be a complete image, not a truncated write.
	entries, err := os.ReadDir(cache.Dir)
	if err != nil {
		t.Fatalf("read cache dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("cache holds %d files, want exactly 1", len(entries))
	}
	stored, err := os.ReadFile(filepath.Join(cache.Dir, entries[0].Name()))
	if err != nil {
		t.Fatalf("read entry: %v", err)
	}
	if !bytes.Equal(stored, results[0]) {
		t.Error("stored entry does not match the served bytes")
	}
	if names := tmpFiles(t, cache.Dir); len(names) != 0 {
		t.Errorf("temporary files left behind: %v", names)
	}
}

func TestEvictTrimsToMaxBytesLeastRecentlyUsedFirst(t *testing.T) {
	dir := t.TempDir()
	cache := &Cache{Dir: dir, MaxBytes: 300}

	// 100 bytes each; "old" is the least recently used.
	now := time.Now()
	for i, name := range []string{"old.jpg", "mid.jpg", "new.jpg", "newest.jpg"} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, bytes.Repeat([]byte{'x'}, 100), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		stamp := now.Add(time.Duration(i) * time.Minute)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("chtimes %s: %v", name, err)
		}
	}

	cache.Evict()

	if _, err := os.Stat(filepath.Join(dir, "old.jpg")); !os.IsNotExist(err) {
		t.Error("least recently used entry survived eviction")
	}
	for _, keep := range []string{"mid.jpg", "new.jpg", "newest.jpg"} {
		if _, err := os.Stat(filepath.Join(dir, keep)); err != nil {
			t.Errorf("%s was evicted: %v", keep, err)
		}
	}
}

func TestEvictReclaimsOnlyStaleTemporaries(t *testing.T) {
	dir := t.TempDir()
	cache := &Cache{Dir: dir, MaxBytes: 1 << 20}

	stale := filepath.Join(dir, "abc.123.tmp")
	fresh := filepath.Join(dir, "def.456.tmp")
	for _, p := range []string{stale, fresh} {
		if err := os.WriteFile(p, []byte("partial"), 0o644); err != nil {
			t.Fatalf("write %s: %v", p, err)
		}
	}
	old := time.Now().Add(-2 * tmpMaxAge)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	cache.Evict()

	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Error("stale temporary from an abandoned write was not reclaimed")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Error("temporary from an in-flight write was removed")
	}
}

// A hit refreshes the entry, so eviction is LRU and not oldest-written.
func TestCacheHitRefreshesRecency(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	track := filepath.Join(base, "Album", "track.mp3")
	writeMP3(t, track, "image/png", pngBytes(t, 8, 8, color.RGBA{R: 255, A: 255}))

	if _, _, err := cache.Thumbnail(track, 0); err != nil {
		t.Fatalf("prime: %v", err)
	}
	entries, err := os.ReadDir(cache.Dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("cache dir: %d entries, err %v", len(entries), err)
	}
	path := filepath.Join(cache.Dir, entries[0].Name())
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	if _, _, err := cache.Thumbnail(track, 0); err != nil {
		t.Fatalf("cache hit: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if !info.ModTime().After(old.Add(time.Minute)) {
		t.Error("cache hit did not refresh the entry's recency")
	}
}

// noteWrite is what triggers a sweep in production, so the byte threshold
// has to reach Evict on its own.
func TestNoteWriteTriggersEvictionOnceThresholdIsPassed(t *testing.T) {
	dir := t.TempDir()
	cache := &Cache{Dir: dir, MaxBytes: 100}
	path := filepath.Join(dir, "entry.jpg")
	if err := os.WriteFile(path, bytes.Repeat([]byte{'x'}, 500), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	cache.noteWrite(sweepBytes - 1)
	if _, err := os.Stat(path); err != nil {
		t.Fatal("swept before the write threshold was reached")
	}
	cache.noteWrite(1)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("crossing the write threshold did not trim an over-size cache")
	}
}

func TestEvictIsSafeUnderConcurrency(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache"), MaxBytes: 4096}
	dir := filepath.Join(base, "Album")

	var wg sync.WaitGroup
	for i := range 16 {
		track := filepath.Join(dir, string(rune('a'+i))+".mp3")
		writeMP3(t, track, "image/png", pngBytes(t, 128+i, 128, color.RGBA{R: uint8(i * 8), A: 255}))
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := cache.Thumbnail(track, 64); err != nil {
				t.Errorf("thumbnail %s: %v", track, err)
			}
			cache.Evict()
		}()
	}
	wg.Wait()

	if names := tmpFiles(t, cache.Dir); len(names) != 0 {
		t.Errorf("temporary files left behind: %v", names)
	}
}

// The memo is keyed on the directory's mtime. Renaming the cover changes
// the fallback without touching any file's contents, which is the case the
// memo has to catch.
func TestThumbnailFollowsRenamedFolderImage(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	dir := filepath.Join(base, "Album")
	track := filepath.Join(dir, "track.mp3")
	writeSilentMP3(t, track)

	// "cover" sorts before "folder", so while both exist cover.png wins.
	cover := pngBytes(t, 8, 8, color.RGBA{R: 255, A: 255})
	folder := pngBytes(t, 16, 16, color.RGBA{B: 255, A: 255})
	if err := os.WriteFile(filepath.Join(dir, "cover.png"), cover, 0o644); err != nil {
		t.Fatalf("write cover: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "folder.png"), folder, 0o644); err != nil {
		t.Fatalf("write folder: %v", err)
	}
	if got, _, err := cache.Thumbnail(track, 0); err != nil || !bytes.Equal(got, cover) {
		t.Fatalf("first read did not serve cover.png (err %v)", err)
	}

	if err := os.Remove(filepath.Join(dir, "cover.png")); err != nil {
		t.Fatalf("remove cover: %v", err)
	}
	got, _, err := cache.Thumbnail(track, 0)
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if !bytes.Equal(got, folder) {
		t.Error("removing cover.png did not fall through to folder.png")
	}
}

// Repeated hits serve the same entry; the memo must not cause drift.
func TestThumbnailStableAcrossRepeatedHits(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	track := filepath.Join(base, "Album", "track.mp3")
	writeMP3(t, track, "image/png", pngBytes(t, 40, 40, color.RGBA{G: 200, A: 255}))

	first, firstType, err := cache.Thumbnail(track, 32)
	if err != nil {
		t.Fatalf("prime: %v", err)
	}
	for i := range 20 {
		got, gotType, err := cache.Thumbnail(track, 32)
		if err != nil {
			t.Fatalf("hit %d: %v", i, err)
		}
		if !bytes.Equal(got, first) || gotType != firstType {
			t.Fatalf("hit %d drifted from the first response", i)
		}
	}
	entries, err := os.ReadDir(cache.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("cache holds %d files after 21 requests, want 1", len(entries))
	}
}

// The memo must not grow with the library.
func TestCoverMemoIsBounded(t *testing.T) {
	base := t.TempDir()
	cache := &Cache{Dir: filepath.Join(base, "cache")}
	for i := range int(maxMemoDirs) + 16 {
		dir := filepath.Join(base, "lib", strconv.Itoa(i))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		cache.coverPath(dir)
	}
	if got := cache.coverCount.Load(); got > maxMemoDirs {
		t.Errorf("memo holds %d directories, want at most %d", got, maxMemoDirs)
	}
	var n int64
	cache.covers.Range(func(_, _ any) bool { n++; return true })
	if n > maxMemoDirs {
		t.Errorf("memo map holds %d entries, want at most %d", n, maxMemoDirs)
	}
}
