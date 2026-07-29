// Package webui embeds the built web client into the server binary.
//
// `make web` copies web/dist into the assets directory. It is empty in a fresh
// checkout so a plain `go build` still works, and the binary then serves a
// placeholder explaining how to build the client.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:assets
var embedded embed.FS

const placeholderIndex = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rhythm</title>
  </head>
  <body style="font-family: system-ui; margin: 4rem auto; max-width: 40rem; line-height: 1.6">
    <h1>Rhythm</h1>
    <p>No web client is embedded in this binary.</p>
    <p>Build it with <code>make build</code>, or run the Vite dev server with
      <code>pnpm --dir web dev</code> and use that origin instead.</p>
    <p>The API is running: try <code>/api/roots</code>.</p>
  </body>
</html>
`

// FS returns the embedded client and reports whether a real build is present.
func FS() (fs.FS, bool) {
	sub, err := fs.Sub(embedded, "assets")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return sub, false
	}
	return sub, true
}

// PlaceholderIndex is the page served when no client build is embedded.
func PlaceholderIndex() []byte { return []byte(placeholderIndex) }
