package library

import (
	"fmt"
	"os"
	"path"
	"sort"
	"strings"
	"time"
)

// AudioExtensions is the whitelist of what gets listed. Not all of it is
// playable yet; showing the library as it really is beats hiding files.
var AudioExtensions = map[string]struct{}{
	".flac": {},
	".mp3":  {},
	".m4a":  {},
	".ogg":  {},
	".opus": {},
	".wav":  {},
	".aiff": {},
	".aif":  {},
	".dsf":  {},
	".dff":  {},
	".mka":  {},
	".thd":  {},
	".dts":  {},
	".wma":  {},
}

// IsAudioFile reports whether a filename carries a whitelisted audio extension.
func IsAudioFile(name string) bool {
	ext := strings.ToLower(path.Ext(name))
	_, ok := AudioExtensions[ext]
	return ok
}

// Entry is one row of a listing. ID is set for files only; directories are
// addressed by their path.
type Entry struct {
	Name    string     `json:"name"`
	Path    string     `json:"path"`
	IsDir   bool       `json:"isDir"`
	ID      string     `json:"id,omitempty"`
	Ext     string     `json:"ext,omitempty"`
	Size    int64      `json:"size,omitempty"`
	ModTime *time.Time `json:"modTime,omitempty"`
}

// Listing is the response body of a browse request.
type Listing struct {
	RootID  string  `json:"rootId"`
	Root    string  `json:"root"`
	Path    string  `json:"path"`
	Parent  *string `json:"parent"`
	Entries []Entry `json:"entries"`
}

// Browse lists one directory: subdirectories and whitelisted audio files,
// skipping hidden entries and everything else.
func (r *Registry) Browse(rootID, relPath string) (*Listing, error) {
	root, err := r.Root(rootID)
	if err != nil {
		return nil, err
	}
	abs, err := root.Resolve(relPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, relPath)
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%w: %s", ErrNotDir, relPath)
	}
	cleaned, err := root.RelOf(abs)
	if err != nil {
		return nil, err
	}

	dirEntries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}

	listing := &Listing{
		RootID:  root.ID,
		Root:    root.Name,
		Path:    cleaned,
		Parent:  parentOf(cleaned),
		Entries: make([]Entry, 0, len(dirEntries)),
	}
	for _, de := range dirEntries {
		name := de.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		// A symlink's target decides what it is. One that leaves the root or
		// dangles fails to resolve and is left out.
		childRel := path.Join(cleaned, name)
		childAbs, err := root.Resolve(childRel)
		if err != nil {
			continue
		}
		info, err := os.Stat(childAbs)
		if err != nil {
			continue
		}
		switch {
		case info.IsDir():
			listing.Entries = append(listing.Entries, Entry{
				Name:  name,
				Path:  childRel,
				IsDir: true,
			})
		case info.Mode().IsRegular() && IsAudioFile(name):
			modTime := info.ModTime()
			listing.Entries = append(listing.Entries, Entry{
				Name:    name,
				Path:    childRel,
				ID:      FileID(root.ID, childRel),
				Ext:     strings.TrimPrefix(strings.ToLower(path.Ext(name)), "."),
				Size:    info.Size(),
				ModTime: &modTime,
			})
		}
	}
	sortEntries(listing.Entries)
	return listing, nil
}

// ResolveFile turns a file ID into the path of a regular audio file in its root.
func (r *Registry) ResolveFile(id string) (*Root, string, error) {
	rootID, relPath, err := ParseFileID(id)
	if err != nil {
		return nil, "", err
	}
	root, err := r.Root(rootID)
	if err != nil {
		return nil, "", err
	}
	abs, err := root.Resolve(relPath)
	if err != nil {
		return nil, "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", fmt.Errorf("%w: %s", ErrNotFound, relPath)
		}
		return nil, "", err
	}
	if !info.Mode().IsRegular() {
		return nil, "", fmt.Errorf("%w: %s", ErrNotFile, relPath)
	}
	if !IsAudioFile(abs) {
		return nil, "", fmt.Errorf("%w: %s", ErrNotFound, relPath)
	}
	return root, abs, nil
}

func parentOf(rel string) *string {
	if rel == "" {
		return nil
	}
	parent := path.Dir(rel)
	if parent == "." || parent == "/" {
		parent = ""
	}
	return &parent
}

// sortEntries puts directories first, then sorts case-insensitively, with a
// byte comparison as tie-breaker so the order is total.
func sortEntries(entries []Entry) {
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		la, lb := strings.ToLower(a.Name), strings.ToLower(b.Name)
		if la != lb {
			return la < lb
		}
		return a.Name < b.Name
	})
}
