# Rhythm

Self-hosted music streaming that owns its whole stack: a Go server, a web player, and eventually a desktop app. No third-party client ecosystem to design around.

It's early. Right now `rhythm --music ~/Music` gives you a page that lists your files and plays one when you click it. That's genuinely all of it. The real playback engine, the library index, and a UI you'd want to look at are still ahead.

No telemetry. No analytics, no phone-home, no crash reporting, and that isn't going to change.

## Running it

```sh
make build
./rhythm --music ~/Music
```

Open <http://127.0.0.1:4533>.

| Flag          | Default                   | What it does                                    |
| ------------- | ------------------------- | ----------------------------------------------- |
| `--music`     | _(required)_              | A directory to serve as your library            |
| `--host`      | `127.0.0.1`               | Bind address                                    |
| `--port`      | `4533`                    | Port. `0` picks a free one and logs it          |
| `--data-dir`  | OS config dir + `/rhythm` | Where Rhythm keeps its own state                |
| `--log-level` | `info`                    | `debug`, `info`, `warn`, `error`                |

There's no authentication yet, which is why it binds loopback by default. Don't put it on `--host 0.0.0.0` unless you trust everyone who can reach it.

The data directory gets created but nothing is written to it yet. The SQLite index and caches will live there once they exist.

### Docker

```sh
docker build --tag rhythm .
docker run --rm -p 4533:4533 \
  -v "$HOME/Music:/music:ro" \
  -v "$HOME/.local/share/rhythm:/data" \
  rhythm
```

The image is `scratch` plus the static binary. It runs as UID 65532 and wants your library mounted read-only at `/music`.

## What plays

Files go to a plain `<audio>` element for now, so you get whatever your browser decodes natively: FLAC, MP3, AAC, Ogg/Vorbis, Opus, WAV, plus ALAC if you're on Safari.

Plenty of other formats show up in the file list without playing yet: ALAC outside Safari, DSD, WMA, and the Dolby codecs that hide behind an `.m4a` extension. Click one and the player tells you it can't decode it. They're listed anyway, because showing you half your library and pretending the rest doesn't exist is worse than admitting the gap.

## Developing

Two processes. The Go API, and Vite proxying `/api` to it.

```sh
cd server && go run ./cmd/rhythm --music ~/Music   # terminal 1
cd web && pnpm install && pnpm dev                 # terminal 2, then localhost:5173
```

The frontend uses pnpm. Not npm, not yarn.

Everything CI checks, you can run locally:

```sh
make test        # go test, -race, vet, mod tidy -diff; vitest, tsc, prettier
make fmt         # gofmt + prettier
make build       # build the client, embed it, compile one binary
make docker
```

`make build` copies `web/dist` into `server/internal/webui/assets`, which is generated and git-ignored. A bare `go build` still works if you skip that step; the binary just serves a placeholder page telling you to build the client.

## API

Deliberately small. It'll grow.

| Endpoint                      | What it returns                                 |
| ----------------------------- | ----------------------------------------------- |
| `GET /api/roots`              | Configured libraries and their filesystem roots |
| `GET /api/browse?path=&root=` | One directory: subfolders and audio files       |
| `GET /api/stream/{id}`        | File bytes, with full HTTP range support        |

Responses are JSON, and the client validates every one of them against a schema before using it.

A file id looks like `<rootID>:<base64url(relative path)>`. Qualifying it by root means two libraries containing the same relative path stay two different files. Paths get canonicalised and confined to their root, and symlinks are resolved before that check happens, so one pointing outside your library is neither listed nor served.

## Layout

```
server/    Go: cmd/rhythm, internal/{library,stream,api,webui}
web/       React 19 + Vite + TypeScript, and later the desktop app's UI too
```

The reasoning behind these choices, and what's deliberately not built yet, is in [rhythm-build-plan.md](rhythm-build-plan.md).

## License

AGPLv3. See [LICENSE](LICENSE).
