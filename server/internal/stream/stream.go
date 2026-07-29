// Package stream serves library files as byte ranges. The server hands over
// bytes; decoding is the client's job.
package stream

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// contentTypes maps extensions to the type a client should see. Go's mime table
// is platform-dependent and leaves several of these wrong or blank, and a wrong
// audio type can stop a browser from decoding.
var contentTypes = map[string]string{
	".flac": "audio/flac",
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".ogg":  "audio/ogg",
	".opus": "audio/ogg",
	".wav":  "audio/wav",
	".aiff": "audio/aiff",
	".aif":  "audio/aiff",
	".dsf":  "audio/x-dsf",
	".dff":  "audio/x-dff",
	".mka":  "audio/x-matroska",
	".thd":  "audio/true-hd",
	".dts":  "audio/vnd.dts",
	".wma":  "audio/x-ms-wma",
}

// ContentType returns the audio MIME type for a path, or a generic binary type
// for anything unrecognized.
func ContentType(name string) string {
	if ct, ok := contentTypes[strings.ToLower(filepath.Ext(name))]; ok {
		return ct
	}
	return "application/octet-stream"
}

// ServeFile writes a file with full range support. ServeContent handles Range,
// If-Range, conditional requests and 206/416 responses; seeking depends on it.
func ServeFile(w http.ResponseWriter, req *http.Request, absPath string) error {
	f, err := os.Open(absPath)
	if err != nil {
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}

	w.Header().Set("Content-Type", ContentType(absPath))
	w.Header().Set("Accept-Ranges", "bytes")
	// Private, so a shared proxy never caches someone's library.
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, req, filepath.Base(absPath), info.ModTime(), f)
	return nil
}
