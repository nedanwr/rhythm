package library

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func testRegistry(t *testing.T, rootIDs ...string) (*Registry, []*Root) {
	t.Helper()
	roots := make([]*Root, 0, len(rootIDs))
	for _, id := range rootIDs {
		roots = append(roots, testRoot(t, id))
	}
	reg, err := NewRegistry(&Library{ID: "default", Name: "Music", Roots: roots})
	if err != nil {
		t.Fatal(err)
	}
	return reg, roots
}

func entryNames(l *Listing) []string {
	names := make([]string, 0, len(l.Entries))
	for _, e := range l.Entries {
		names = append(names, e.Name)
	}
	return names
}

func TestBrowseListsDirsFirstThenAudioOnly(t *testing.T) {
	reg, roots := testRegistry(t, "default")
	root := roots[0]
	write(t, root, "Zeta Album/track.flac", "x")
	write(t, root, "alpha Album/track.flac", "x")
	write(t, root, "b.mp3", "x")
	write(t, root, "A.flac", "x")
	write(t, root, "cover.jpg", "x")
	write(t, root, "notes.txt", "x")
	write(t, root, ".hidden.flac", "x")

	listing, err := reg.Browse("default", "")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"alpha Album", "Zeta Album", "A.flac", "b.mp3"}
	got := entryNames(listing)
	if len(got) != len(want) {
		t.Fatalf("entries = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("entries = %v, want %v", got, want)
		}
	}
	if listing.Parent != nil {
		t.Errorf("root parent = %v, want nil", listing.Parent)
	}
}

func TestBrowseEntryFields(t *testing.T) {
	reg, roots := testRegistry(t, "default")
	write(t, roots[0], "Artist/Album/01 Track.flac", "hello")

	listing, err := reg.Browse("default", "Artist/Album")
	if err != nil {
		t.Fatal(err)
	}
	if listing.Path != "Artist/Album" {
		t.Errorf("path = %q", listing.Path)
	}
	if listing.Parent == nil || *listing.Parent != "Artist" {
		t.Errorf("parent = %v, want Artist", listing.Parent)
	}
	if len(listing.Entries) != 1 {
		t.Fatalf("entries = %v", entryNames(listing))
	}
	e := listing.Entries[0]
	if e.IsDir || e.Ext != "flac" || e.Size != 5 || e.ModTime == nil {
		t.Errorf("entry = %+v", e)
	}
	if want := FileID("default", "Artist/Album/01 Track.flac"); e.ID != want {
		t.Errorf("id = %q, want %q", e.ID, want)
	}
}

func TestBrowseEmptyLibrary(t *testing.T) {
	reg, _ := testRegistry(t, "default")
	listing, err := reg.Browse("default", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 0 {
		t.Errorf("entries = %v, want none", entryNames(listing))
	}
}

func TestBrowseAwkwardNames(t *testing.T) {
	reg, roots := testRegistry(t, "default")
	names := []string{
		"Ólafur Arnalds — re:member.flac",
		"100% _ complete.mp3",
		"a b  c#d&e?f.opus",
	}
	for _, n := range names {
		write(t, roots[0], n, "x")
	}
	listing, err := reg.Browse("default", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != len(names) {
		t.Fatalf("entries = %v", entryNames(listing))
	}
	for _, e := range listing.Entries {
		_, rel, err := ParseFileID(e.ID)
		if err != nil || rel != e.Path {
			t.Errorf("id for %q did not round trip: rel=%q err=%v", e.Name, rel, err)
		}
	}
}

func TestBrowseDeepPath(t *testing.T) {
	reg, roots := testRegistry(t, "default")
	deep := "a/b/c/d/e/f/g/h/i/j"
	write(t, roots[0], deep+"/track.flac", "x")
	listing, err := reg.Browse("default", deep)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 1 || listing.Entries[0].Name != "track.flac" {
		t.Errorf("entries = %v", entryNames(listing))
	}
}

func TestBrowseErrors(t *testing.T) {
	reg, roots := testRegistry(t, "default")
	write(t, roots[0], "track.flac", "x")

	if _, err := reg.Browse("nope", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown root error = %v, want ErrNotFound", err)
	}
	if _, err := reg.Browse("default", "missing"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing dir error = %v, want ErrNotFound", err)
	}
	if _, err := reg.Browse("default", "track.flac"); !errors.Is(err, ErrNotDir) {
		t.Errorf("file-as-dir error = %v, want ErrNotDir", err)
	}
	if _, err := reg.Browse("default", "a\x00b"); !errors.Is(err, ErrInvalidPath) {
		t.Errorf("NUL error = %v, want ErrInvalidPath", err)
	}
}

// The same relative path in two roots must stay two files — the reason IDs are
// root-qualified.
func TestDuplicateRelativePathsAcrossRoots(t *testing.T) {
	reg, roots := testRegistry(t, "one", "two")
	write(t, roots[0], "Album/track.flac", "first")
	write(t, roots[1], "Album/track.flac", "second")

	idOne := FileID("one", "Album/track.flac")
	idTwo := FileID("two", "Album/track.flac")
	if idOne == idTwo {
		t.Fatal("ids collided across roots")
	}
	for id, want := range map[string]string{idOne: "first", idTwo: "second"} {
		_, abs, err := reg.ResolveFile(id)
		if err != nil {
			t.Fatalf("ResolveFile(%q): %v", id, err)
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			t.Fatal(err)
		}
		if string(data) != want {
			t.Errorf("id %q read %q, want %q", id, data, want)
		}
	}
}

func TestResolveFileRejectsNonAudioAndDirs(t *testing.T) {
	reg, roots := testRegistry(t, "default")
	write(t, roots[0], "cover.jpg", "x")
	if err := os.MkdirAll(filepath.Join(roots[0].Path, "Album"), 0o755); err != nil {
		t.Fatal(err)
	}

	if _, _, err := reg.ResolveFile(FileID("default", "cover.jpg")); !errors.Is(err, ErrNotFound) {
		t.Errorf("non-audio error = %v, want ErrNotFound", err)
	}
	if _, _, err := reg.ResolveFile(FileID("default", "Album")); !errors.Is(err, ErrNotFile) {
		t.Errorf("directory error = %v, want ErrNotFile", err)
	}
	if _, _, err := reg.ResolveFile(FileID("default", "../../etc/passwd")); !errors.Is(err, ErrNotFound) {
		t.Errorf("traversal error = %v, want ErrNotFound", err)
	}
}

func TestNewRegistryRejectsBadRoots(t *testing.T) {
	dup := &Library{ID: "l", Roots: []*Root{
		{ID: "a", Path: "/tmp"},
		{ID: "a", Path: "/tmp"},
	}}
	if _, err := NewRegistry(dup); err == nil {
		t.Error("duplicate root id accepted")
	}
	colon := &Library{ID: "l", Roots: []*Root{{ID: "a:b", Path: "/tmp"}}}
	if _, err := NewRegistry(colon); err == nil {
		t.Error("root id with separator accepted")
	}
	rel := &Library{ID: "l", Roots: []*Root{{ID: "a", Path: "relative"}}}
	if _, err := NewRegistry(rel); err == nil {
		t.Error("relative root path accepted")
	}
}

func TestDefaultRootEmptyRegistry(t *testing.T) {
	reg, err := NewRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reg.DefaultRoot(); !errors.Is(err, ErrNotFound) {
		t.Errorf("error = %v, want ErrNotFound", err)
	}
}

func TestIsAudioFile(t *testing.T) {
	yes := []string{"a.flac", "a.FLAC", "a.mp3", "a.m4a", "a.dsf", "a.thd", "a.wma", "a.opus"}
	no := []string{"a.jpg", "a.txt", "a", "a.flac.txt", "flac"}
	for _, n := range yes {
		if !IsAudioFile(n) {
			t.Errorf("IsAudioFile(%q) = false", n)
		}
	}
	for _, n := range no {
		if IsAudioFile(n) {
			t.Errorf("IsAudioFile(%q) = true", n)
		}
	}
}
