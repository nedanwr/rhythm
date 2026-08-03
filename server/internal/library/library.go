// Package library models Rhythm's library/root/file structure and resolves
// API-visible identifiers to real files on disk.
//
// A library owns one or more filesystem roots, and a file is identified by
// (root, relative path) rather than by an absolute path. Listings are read
// straight from the filesystem for now.
package library

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// Errors returned by resolution and browsing. Callers map these to status codes.
var (
	// ErrNotFound means the root, id, or path does not exist.
	ErrNotFound = errors.New("not found")
	// ErrInvalidPath means the request was malformed or escaped the root.
	ErrInvalidPath = errors.New("invalid path")
	// ErrNotDir / ErrNotFile mean the target exists but is the wrong kind.
	ErrNotDir  = errors.New("not a directory")
	ErrNotFile = errors.New("not a file")
)

// Root is one directory belonging to a library. Path is absolute and
// symlink-resolved, which is what makes containment checks meaningful.
type Root struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

// Library is a named collection of roots.
type Library struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Roots []*Root `json:"roots"`
}

// Registry holds every library the server knows about and indexes their roots.
type Registry struct {
	libraries []*Library
	roots     map[string]*Root
}

// NewRegistry checks that root IDs are unique and usable inside file IDs.
func NewRegistry(libraries ...*Library) (*Registry, error) {
	reg := &Registry{roots: make(map[string]*Root)}
	for _, lib := range libraries {
		if lib == nil {
			return nil, errors.New("library: nil library")
		}
		for _, root := range lib.Roots {
			if err := validRootID(root.ID); err != nil {
				return nil, err
			}
			if _, dup := reg.roots[root.ID]; dup {
				return nil, fmt.Errorf("library: duplicate root id %q", root.ID)
			}
			if !filepath.IsAbs(root.Path) {
				return nil, fmt.Errorf("library: root %q path is not absolute: %q", root.ID, root.Path)
			}
			reg.roots[root.ID] = root
		}
		reg.libraries = append(reg.libraries, lib)
	}
	return reg, nil
}

func validRootID(id string) error {
	if id == "" {
		return errors.New("library: empty root id")
	}
	if strings.ContainsAny(id, idSeparator+"/\\\x00") {
		return fmt.Errorf("library: root id %q contains a reserved character", id)
	}
	return nil
}

// Libraries returns the configured libraries in declaration order.
func (r *Registry) Libraries() []*Library {
	out := make([]*Library, len(r.libraries))
	copy(out, r.libraries)
	return out
}

// Root looks up a root by ID.
func (r *Registry) Root(id string) (*Root, error) {
	root, ok := r.roots[id]
	if !ok {
		return nil, fmt.Errorf("%w: root %q", ErrNotFound, id)
	}
	return root, nil
}

// DefaultRoot returns the first library's first root, used by clients that
// omit a root ID.
func (r *Registry) DefaultRoot() (*Root, error) {
	if len(r.libraries) == 0 || len(r.libraries[0].Roots) == 0 {
		return nil, fmt.Errorf("%w: no roots configured", ErrNotFound)
	}
	return r.libraries[0].Roots[0], nil
}

// Roots returns every root, sorted by ID for stable output.
func (r *Registry) Roots() []*Root {
	out := make([]*Root, 0, len(r.roots))
	for _, root := range r.roots {
		out = append(out, root)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
