package library

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCleanRelPathConfinesInput(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"/", ""},
		{".", ""},
		{"Artist/Album", "Artist/Album"},
		{"/Artist/Album/", "Artist/Album"},
		{"../../etc/passwd", "etc/passwd"},
		{"Artist/../../../etc/passwd", "etc/passwd"},
		{"Artist/./Album//Track.flac", "Artist/Album/Track.flac"},
		{"..", ""},
		{"Ólafur Arnalds/50% _ off", "Ólafur Arnalds/50% _ off"},
	}
	for _, tc := range cases {
		got, err := CleanRelPath(tc.in)
		if err != nil {
			t.Fatalf("CleanRelPath(%q): %v", tc.in, err)
		}
		if got != tc.want {
			t.Errorf("CleanRelPath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestCleanRelPathRejectsHostileBytes(t *testing.T) {
	for _, in := range []string{"a\x00b", `..\..\windows`, `Artist\Album`} {
		if _, err := CleanRelPath(in); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("CleanRelPath(%q) error = %v, want ErrInvalidPath", in, err)
		}
	}
}

func TestFileIDRoundTrip(t *testing.T) {
	for _, rel := range []string{
		"Artist/Album/01 Track.flac",
		"Ólafur Arnalds/re:member/01 ekki hugsa.flac",
		"weird/100% _ #hash & ?query.mp3",
		"",
	} {
		rootID, got, err := ParseFileID(FileID("default", rel))
		if err != nil {
			t.Fatalf("ParseFileID(%q): %v", rel, err)
		}
		if rootID != "default" || got != rel {
			t.Errorf("round trip = (%q, %q), want (default, %q)", rootID, got, rel)
		}
	}
}

func TestParseFileIDRejectsMalformed(t *testing.T) {
	for _, id := range []string{"", "no-separator", ":abc", "default:!!!not-base64"} {
		if _, _, err := ParseFileID(id); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("ParseFileID(%q) error = %v, want ErrInvalidPath", id, err)
		}
	}
}

// testRoot builds a symlink-resolved root over a temp dir, as the server does
// at startup. On macOS /var is itself a symlink, so this matters.
func testRoot(t *testing.T, id string) *Root {
	t.Helper()
	dir := t.TempDir()
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	return &Root{ID: id, Name: id, Path: resolved}
}

func write(t *testing.T, root *Root, rel string, data string) string {
	t.Helper()
	abs := filepath.Join(root.Path, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	return abs
}

func TestResolveStaysInsideRoot(t *testing.T) {
	root := testRoot(t, "default")
	want := write(t, root, "Artist/Album/track.flac", "x")

	got, err := root.Resolve("Artist/Album/track.flac")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != want {
		t.Errorf("Resolve = %q, want %q", got, want)
	}

	// Traversal is normalized away before touching disk, so it can only resolve
	// to something that does not exist inside the root.
	if _, err := root.Resolve("../../../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Errorf("traversal error = %v, want ErrNotFound", err)
	}
}

func TestResolveRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs privileges on Windows")
	}
	root := testRoot(t, "default")
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.flac"), []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root.Path, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.flac"), filepath.Join(root.Path, "secret.flac")); err != nil {
		t.Fatal(err)
	}

	for _, rel := range []string{"escape", "escape/secret.flac", "secret.flac"} {
		if _, err := root.Resolve(rel); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("Resolve(%q) error = %v, want ErrInvalidPath", rel, err)
		}
	}
}

func TestResolveFollowsSymlinkInsideRoot(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs privileges on Windows")
	}
	root := testRoot(t, "default")
	target := write(t, root, "real/track.flac", "x")
	if err := os.Symlink(filepath.Join(root.Path, "real"), filepath.Join(root.Path, "link")); err != nil {
		t.Fatal(err)
	}
	got, err := root.Resolve("link/track.flac")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != target {
		t.Errorf("Resolve = %q, want %q", got, target)
	}
}

func TestResolveDanglingSymlinkIsNotFound(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs privileges on Windows")
	}
	root := testRoot(t, "default")
	if err := os.Symlink(filepath.Join(root.Path, "missing.flac"), filepath.Join(root.Path, "dangling.flac")); err != nil {
		t.Fatal(err)
	}
	if _, err := root.Resolve("dangling.flac"); !errors.Is(err, ErrNotFound) {
		t.Errorf("error = %v, want ErrNotFound", err)
	}
}

func TestRelOf(t *testing.T) {
	root := testRoot(t, "default")
	abs := write(t, root, "a/b/c.flac", "x")
	rel, err := root.RelOf(abs)
	if err != nil {
		t.Fatal(err)
	}
	if rel != "a/b/c.flac" {
		t.Errorf("RelOf = %q, want a/b/c.flac", rel)
	}
	if rel, err := root.RelOf(root.Path); err != nil || rel != "" {
		t.Errorf("RelOf(root) = (%q, %v), want (\"\", nil)", rel, err)
	}
}
