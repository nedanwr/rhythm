package stream

import "testing"

func TestContentType(t *testing.T) {
	cases := map[string]string{
		"/music/a.flac":     "audio/flac",
		"/music/a.FLAC":     "audio/flac",
		"/music/a.mp3":      "audio/mpeg",
		"/music/a.m4a":      "audio/mp4",
		"/music/a.opus":     "audio/ogg",
		"/music/a.dsf":      "audio/x-dsf",
		"/music/cover.jpg":  "application/octet-stream",
		"/music/no-ext":     "application/octet-stream",
		"/music/a.flac.txt": "application/octet-stream",
	}
	for name, want := range cases {
		if got := ContentType(name); got != want {
			t.Errorf("ContentType(%q) = %q, want %q", name, got, want)
		}
	}
}
