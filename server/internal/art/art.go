// Package art extracts embedded cover art (FLAC PICTURE, ID3v2 APIC, MP4
// covr) with a folder-image fallback, and serves cached resized thumbnails.
package art

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/image/draw"
)

var ErrNoArt = errors.New("no artwork")

// Extract returns raw embedded image bytes, falling back to a cover image
// in the same directory.
func Extract(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var data []byte
	switch strings.ToLower(filepath.Ext(path)) {
	case ".flac":
		data, _ = flacPicture(f)
	case ".mp3":
		data, _ = id3Picture(f)
	case ".m4a":
		data, _ = mp4Picture(f)
	}
	if len(data) > 0 {
		return data, nil
	}
	return folderImage(filepath.Dir(path))
}

var folderNames = []string{"cover", "folder", "front", "album"}

func folderImage(dir string) ([]byte, error) {
	path, err := folderImagePath(dir)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, ErrNoArt
	}
	return data, nil
}

// folderImagePath returns the cover Extract would fall back to. Split out
// so the cache can fingerprint that file without reading it.
func folderImagePath(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", ErrNoArt
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := strings.ToLower(e.Name())
		ext := filepath.Ext(name)
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		base := strings.TrimSuffix(name, ext)
		for _, want := range folderNames {
			if base == want {
				return filepath.Join(dir, e.Name()), nil
			}
		}
	}
	return "", ErrNoArt
}

// --- FLAC: metadata block type 6 (PICTURE) ---

func flacPicture(f *os.File) ([]byte, error) {
	hdr := make([]byte, 4)
	if _, err := io.ReadFull(f, hdr); err != nil || string(hdr) != "fLaC" {
		return nil, ErrNoArt
	}
	bh := make([]byte, 4)
	for {
		if _, err := io.ReadFull(f, bh); err != nil {
			return nil, ErrNoArt
		}
		last := bh[0]&0x80 != 0
		typ := bh[0] & 0x7f
		size := int64(bh[1])<<16 | int64(bh[2])<<8 | int64(bh[3])
		if typ == 6 {
			block := make([]byte, size)
			if _, err := io.ReadFull(f, block); err != nil {
				return nil, ErrNoArt
			}
			return parseFlacPictureBlock(block)
		}
		if _, err := f.Seek(size, io.SeekCurrent); err != nil {
			return nil, ErrNoArt
		}
		if last {
			return nil, ErrNoArt
		}
	}
}

func parseFlacPictureBlock(b []byte) ([]byte, error) {
	// 4B type, then length-prefixed mime and description, 4×4B image
	// geometry, then length-prefixed data.
	r := bytes.NewReader(b)
	skip := func(n int64) error { _, err := r.Seek(n, io.SeekCurrent); return err }
	readLen := func() (uint32, error) {
		var n uint32
		err := binary.Read(r, binary.BigEndian, &n)
		return n, err
	}
	if err := skip(4); err != nil {
		return nil, ErrNoArt
	}
	for i := 0; i < 2; i++ { // mime, description
		n, err := readLen()
		if err != nil || skip(int64(n)) != nil {
			return nil, ErrNoArt
		}
	}
	if err := skip(16); err != nil {
		return nil, ErrNoArt
	}
	n, err := readLen()
	if err != nil || int64(n) > int64(r.Len()) {
		return nil, ErrNoArt
	}
	data := make([]byte, n)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, ErrNoArt
	}
	return data, nil
}

// --- MP3: ID3v2.3/2.4 APIC frame ---

func id3Picture(f *os.File) ([]byte, error) {
	hdr := make([]byte, 10)
	if _, err := io.ReadFull(f, hdr); err != nil || string(hdr[:3]) != "ID3" {
		return nil, ErrNoArt
	}
	version := hdr[3]
	tagSize := syncsafe(hdr[6:10])
	if tagSize <= 0 || tagSize > 64<<20 {
		return nil, ErrNoArt
	}
	tag := make([]byte, tagSize)
	if _, err := io.ReadFull(f, tag); err != nil {
		return nil, ErrNoArt
	}
	pos := 0
	for pos+10 <= len(tag) {
		id := string(tag[pos : pos+4])
		if id == "\x00\x00\x00\x00" {
			break
		}
		var size int
		if version == 4 {
			size = syncsafe(tag[pos+4 : pos+8])
		} else {
			size = int(binary.BigEndian.Uint32(tag[pos+4 : pos+8]))
		}
		if size <= 0 || pos+10+size > len(tag) {
			break
		}
		if id == "APIC" {
			return parseApic(tag[pos+10 : pos+10+size])
		}
		pos += 10 + size
	}
	return nil, ErrNoArt
}

func syncsafe(b []byte) int {
	return int(b[0])<<21 | int(b[1])<<14 | int(b[2])<<7 | int(b[3])
}

func parseApic(b []byte) ([]byte, error) {
	if len(b) < 4 {
		return nil, ErrNoArt
	}
	enc := b[0]
	rest := b[1:]
	// MIME type: latin1, null-terminated.
	i := bytes.IndexByte(rest, 0)
	if i < 0 {
		return nil, ErrNoArt
	}
	rest = rest[i+1:]
	if len(rest) < 1 {
		return nil, ErrNoArt
	}
	rest = rest[1:] // picture type
	// Description: UTF-16 encodings terminate with a double null.
	if enc == 1 || enc == 2 {
		i = bytes.Index(rest, []byte{0, 0})
		if i < 0 {
			return nil, ErrNoArt
		}
		// Keep alignment: the terminator is two bytes, possibly offset.
		if (i)%2 != 0 {
			i++
		}
		rest = rest[i+2:]
	} else {
		i = bytes.IndexByte(rest, 0)
		if i < 0 {
			return nil, ErrNoArt
		}
		rest = rest[i+1:]
	}
	if len(rest) == 0 {
		return nil, ErrNoArt
	}
	return rest, nil
}

// --- M4A: moov → udta → meta → ilst → covr → data ---

func mp4Picture(f *os.File) ([]byte, error) {
	info, err := f.Stat()
	if err != nil {
		return nil, ErrNoArt
	}
	data := mp4FindCovr(f, 0, info.Size(), []string{"moov", "udta", "meta", "ilst", "covr"})
	if data == nil {
		return nil, ErrNoArt
	}
	return data, nil
}

func mp4FindCovr(f *os.File, start, end int64, path []string) []byte {
	hdr := make([]byte, 8)
	pos := start
	for pos+8 <= end {
		if _, err := f.ReadAt(hdr, pos); err != nil {
			return nil
		}
		size := int64(binary.BigEndian.Uint32(hdr[:4]))
		typ := string(hdr[4:8])
		bodyStart := pos + 8
		if size == 1 {
			ext := make([]byte, 8)
			if _, err := f.ReadAt(ext, pos+8); err != nil {
				return nil
			}
			size = int64(binary.BigEndian.Uint64(ext))
			bodyStart = pos + 16
		} else if size == 0 {
			size = end - pos
		}
		if size < 8 || pos+size > end {
			return nil
		}
		if len(path) > 0 && typ == path[0] {
			if typ == "meta" {
				bodyStart += 4 // fullbox: version + flags before children
			}
			if len(path) == 1 {
				// Inside covr: the first data box holds the image after
				// 8 bytes of type indicator + locale.
				dh := make([]byte, 8)
				p := bodyStart
				for p+8 <= pos+size {
					if _, err := f.ReadAt(dh, p); err != nil {
						return nil
					}
					dsize := int64(binary.BigEndian.Uint32(dh[:4]))
					if string(dh[4:8]) == "data" && dsize > 16 {
						img := make([]byte, dsize-16)
						if _, err := f.ReadAt(img, p+16); err != nil {
							return nil
						}
						return img
					}
					if dsize < 8 {
						return nil
					}
					p += dsize
				}
				return nil
			}
			return mp4FindCovr(f, bodyStart, pos+size, path[1:])
		}
		pos += size
	}
	return nil
}

// --- thumbnail cache ---

const (
	// DefaultMaxBytes bounds the cache when MaxBytes is unset.
	DefaultMaxBytes int64 = 256 << 20
	// sweepBytes is how much is written between size checks; scanning on
	// every miss would cost more than the cache saves.
	sweepBytes int64 = 32 << 20
	// tmpMaxAge is how long an orphaned temporary survives before a sweep.
	tmpMaxAge = time.Hour
	// maxMemoDirs bounds the folder-image memo so it can't grow with the
	// library.
	maxMemoDirs int64 = 8192
)

// cacheTypes maps an entry's extension to its content type. Keeping the
// type in the name survives a restart without a sidecar or an index.
// Ordered so lookups hit the common case first.
var cacheTypes = []struct{ ext, contentType string }{
	{".jpg", "image/jpeg"},
	{".png", "image/png"},
	{".gif", "image/gif"},
	{".webp", "image/webp"},
	{".bin", "application/octet-stream"},
}

// Cache stores resized cover art on disk, keyed by absolute source path
// and a fingerprint of every file the art could come from.
type Cache struct {
	Dir string
	// MaxBytes bounds the directory; 0 selects DefaultMaxBytes. Anything
	// over is evicted least-recently-used first.
	MaxBytes int64

	written  atomic.Int64
	sweeping atomic.Bool

	// covers memoizes each directory's fallback cover, so a cache hit
	// doesn't re-read the directory.
	covers     sync.Map // dir -> dirCover
	coverCount atomic.Int64
}

type dirCover struct {
	dirMod time.Time
	path   string
	found  bool
}

// Thumbnail returns cached image bytes and their content type, resized to
// a square bound (0 leaves the original untouched).
//
// Keyed per file, not per directory, since embedded art belongs to the
// file. The key uses the absolute path, so the same relative path under
// two roots stays two entries.
func (c *Cache) Thumbnail(audioPath string, size int) ([]byte, string, error) {
	key := c.key(audioPath, size)
	if data, contentType, ok := c.load(key); ok {
		return data, contentType, nil
	}

	raw, err := Extract(audioPath)
	if err != nil {
		return nil, "", err
	}
	out, contentType := raw, detectContentType(raw)
	if size > 0 {
		if resized, err := resizeJPEG(raw, size); err == nil {
			out, contentType = resized, "image/jpeg"
		}
	}
	c.store(key, out, contentType)
	return out, contentType, nil
}

// key covers both inputs that can change the image: the audio file and the
// folder image it would fall back to. Either changing gives a new key, so
// replaced artwork isn't served stale.
//
// Fingerprint is size + mtime. On a filesystem with one-second timestamps
// a same-size rewrite inside that second slips through; hashing contents
// would catch it but costs a read on every hit.
func (c *Cache) key(audioPath string, size int) string {
	h := sha256.New()
	fmt.Fprintf(h, "v2|%d", size)
	fingerprint(h, audioPath)
	if cover, ok := c.coverPath(filepath.Dir(audioPath)); ok {
		fingerprint(h, cover)
	}
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// coverPath reports dir's fallback cover, reusing the last answer while
// dir's mtime holds.
//
// The answer only changes when an entry is added, removed or renamed, and
// those all bump the directory's mtime. Rewriting the cover in place does
// not, and needn't — that file is fingerprinted separately. Without the
// memo every hit costs a directory read, which dominates on a flat folder
// of a few thousand tracks.
func (c *Cache) coverPath(dir string) (string, bool) {
	info, err := os.Stat(dir)
	if err != nil {
		return "", false
	}
	if v, ok := c.covers.Load(dir); ok {
		if e := v.(dirCover); e.dirMod.Equal(info.ModTime()) {
			return e.path, e.found
		}
	}
	path, err := folderImagePath(dir)
	// Drop it wholesale rather than grow with the library; the cost is one
	// directory read per album, which is what the uncached path did.
	if c.coverCount.Load() >= maxMemoDirs {
		c.covers.Clear()
		c.coverCount.Store(0)
	}
	if _, loaded := c.covers.Swap(dir, dirCover{info.ModTime(), path, err == nil}); !loaded {
		c.coverCount.Add(1)
	}
	return path, err == nil
}

func fingerprint(h io.Writer, path string) {
	info, err := os.Stat(path)
	if err != nil {
		fmt.Fprintf(h, "|%s|missing", path)
		return
	}
	fmt.Fprintf(h, "|%s|%d|%d", path, info.Size(), info.ModTime().UnixNano())
}

func (c *Cache) load(key string) ([]byte, string, bool) {
	for _, t := range cacheTypes {
		path := filepath.Join(c.Dir, key+t.ext)
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		// Touch it so eviction is LRU, not oldest-written. Failing only
		// costs accuracy.
		now := time.Now()
		_ = os.Chtimes(path, now, now)
		return data, t.contentType, true
	}
	return nil, "", false
}

// store writes through a uniquely named temporary and renames it into
// place, so two misses on one key can't interleave into a truncated file.
func (c *Cache) store(key string, data []byte, contentType string) {
	if err := os.MkdirAll(c.Dir, 0o755); err != nil {
		return
	}
	tmp, err := os.CreateTemp(c.Dir, key+".*.tmp")
	if err != nil {
		return
	}
	name := tmp.Name()
	_, writeErr := tmp.Write(data)
	closeErr := tmp.Close()
	if writeErr != nil || closeErr != nil {
		os.Remove(name)
		return
	}
	if err := os.Chmod(name, 0o644); err != nil {
		os.Remove(name)
		return
	}
	if err := os.Rename(name, filepath.Join(c.Dir, key+extForType(contentType))); err != nil {
		os.Remove(name)
		return
	}
	c.noteWrite(int64(len(data)))
}

func (c *Cache) noteWrite(n int64) {
	if c.written.Add(n) < sweepBytes {
		return
	}
	c.written.Store(0)
	c.Evict()
}

// Evict trims the directory to MaxBytes, least recently used first, and
// reclaims temporaries from writes that never finished. Safe to call
// concurrently; overlapping calls collapse into one.
func (c *Cache) Evict() {
	if !c.sweeping.CompareAndSwap(false, true) {
		return
	}
	defer c.sweeping.Store(false)

	limit := c.MaxBytes
	if limit <= 0 {
		limit = DefaultMaxBytes
	}
	entries, err := os.ReadDir(c.Dir)
	if err != nil {
		return
	}
	type entry struct {
		name string
		size int64
		used time.Time
	}
	var items []entry
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if strings.HasSuffix(e.Name(), ".tmp") {
			if time.Since(info.ModTime()) > tmpMaxAge {
				os.Remove(filepath.Join(c.Dir, e.Name()))
			}
			continue
		}
		items = append(items, entry{e.Name(), info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= limit {
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].used.Before(items[j].used) })
	for _, it := range items {
		if total <= limit {
			return
		}
		if os.Remove(filepath.Join(c.Dir, it.name)) == nil {
			total -= it.size
		}
	}
}

// detectContentType reports the media type, calling anything unrecognised
// binary rather than mislabelling it JPEG.
func detectContentType(raw []byte) string {
	switch t, _, _ := strings.Cut(http.DetectContentType(raw), ";"); t {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return t
	}
	return "application/octet-stream"
}

func extForType(contentType string) string {
	for _, t := range cacheTypes {
		if t.contentType == contentType {
			return t.ext
		}
	}
	return ".bin"
}

func resizeJPEG(raw []byte, bound int) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= bound && h <= bound {
		// Already small enough; still normalize to JPEG.
		var buf bytes.Buffer
		err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: 85})
		return buf.Bytes(), err
	}
	scale := float64(bound) / float64(max(w, h))
	dst := image.NewRGBA(image.Rect(0, 0, int(float64(w)*scale), int(float64(h)*scale)))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
