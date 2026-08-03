package main

import (
	"bytes"
	"testing"
)

func TestVersion(t *testing.T) {
	previousVersion := version
	version = "0.1.0-alpha.1"
	t.Cleanup(func() { version = previousVersion })

	var output bytes.Buffer
	if err := runWithOutput([]string{"--version"}, &output); err != nil {
		t.Fatalf("run --version: %v", err)
	}
	if got, want := output.String(), "rhythm 0.1.0-alpha.1\n"; got != want {
		t.Fatalf("output = %q, want %q", got, want)
	}
}
