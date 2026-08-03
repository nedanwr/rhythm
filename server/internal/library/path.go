package library

import (
	"encoding/base64"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// idSeparator joins a root ID and an encoded relative path into a file ID.
const idSeparator = ":"

var idEncoding = base64.RawURLEncoding

// FileID builds the identifier a client streams by:
// "<rootID>:<base64url(relative path)>". Encoding keeps filename bytes like
// "#", "%" and "/" out of URL parsing's way, and the root prefix keeps the
// same relative path in two roots two different files.
func FileID(rootID, relPath string) string {
	return rootID + idSeparator + idEncoding.EncodeToString([]byte(relPath))
}

// ParseFileID splits a file ID back apart. It does not touch the filesystem,
// so the returned path is still untrusted.
func ParseFileID(id string) (rootID, relPath string, err error) {
	rootID, encoded, ok := strings.Cut(id, idSeparator)
	if !ok || rootID == "" {
		return "", "", fmt.Errorf("%w: malformed id", ErrInvalidPath)
	}
	raw, decErr := idEncoding.DecodeString(encoded)
	if decErr != nil {
		return "", "", fmt.Errorf("%w: malformed id", ErrInvalidPath)
	}
	return rootID, string(raw), nil
}

// CleanRelPath normalizes a client-supplied, slash-separated path into one that
// cannot escape a root. Cleaning an absolute-rooted copy resolves away leading
// slashes and ".." segments; the result is "" for the root itself.
func CleanRelPath(rel string) (string, error) {
	if strings.ContainsRune(rel, '\x00') {
		return "", fmt.Errorf("%w: NUL byte in path", ErrInvalidPath)
	}
	// Harmless on Unix, but accepting these would let "..\\" through on Windows.
	if strings.ContainsRune(rel, '\\') {
		return "", fmt.Errorf("%w: backslash in path", ErrInvalidPath)
	}
	cleaned := path.Clean("/" + rel)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "." {
		cleaned = ""
	}
	return cleaned, nil
}

// Resolve turns an untrusted relative path into an absolute path inside the
// root. Containment is checked after symlink resolution, so a symlink pointing
// out of the root is rejected rather than followed.
func (r *Root) Resolve(rel string) (string, error) {
	cleaned, err := CleanRelPath(rel)
	if err != nil {
		return "", err
	}
	abs := r.Path
	if cleaned != "" {
		abs = filepath.Join(r.Path, filepath.FromSlash(cleaned))
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("%w: %s", ErrNotFound, cleaned)
		}
		return "", err
	}
	if !within(r.Path, resolved) {
		return "", fmt.Errorf("%w: escapes library root", ErrInvalidPath)
	}
	return resolved, nil
}

// within reports whether target is root or below it. Both must already be
// absolute and symlink-resolved.
func within(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// RelOf returns the slash-separated path of an absolute path known to be
// inside the root.
func (r *Root) RelOf(abs string) (string, error) {
	rel, err := filepath.Rel(r.Path, abs)
	if err != nil {
		return "", err
	}
	if rel == "." {
		return "", nil
	}
	return filepath.ToSlash(rel), nil
}
