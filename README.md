# Rhythm

Self-hosted music streaming that owns its whole stack: a Go server, a web player, and eventually a desktop app. No third-party client ecosystem to design around.

It's early. Right now `rhythm --music ~/Music` gives you a page that lists your files and plays them through Rhythm's own Web Audio engine, gaplessly. The library index and the metadata layer are still ahead.

No telemetry, analytics, crash reporting, or phone-home.

## Running it

```sh
make build
./rhythm --music ~/Music
```

Open <http://127.0.0.1:4533>.

| Flag          | Default                   | What it does                           |
| ------------- | ------------------------- | -------------------------------------- |
| `--music`     | _(required)_              | A directory to serve as your library   |
| `--host`      | `127.0.0.1`               | Bind address                           |
| `--port`      | `4533`                    | Port. `0` picks a free one and logs it |
| `--data-dir`  | OS config dir + `/rhythm` | Where Rhythm keeps its own state       |
| `--log-level` | `info`                    | `debug`, `info`, `warn`, `error`       |

There's no authentication yet, which is why it binds loopback by default. Don't put it on `--host 0.0.0.0` unless you trust everyone who can reach it.

The data directory currently holds the artwork cache. The SQLite library index and other persistent state will live there as they are added.

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

The server sends bytes and the client decodes them. Anything your browser decodes natively plays: FLAC, MP3, AAC, Ogg/Vorbis, Opus, WAV, plus ALAC if you're on Safari.

Unsupported formats—including ALAC outside Safari, DSD, WMA, and some Dolby codecs in `.m4a` containers—still appear in browse results. Decode errors distinguish unsupported formats from likely damaged native files.

Clicking a track queues the whole folder from that point.

### Gapless

Rhythm preloads the next track and schedules it against the Web Audio clock, allowing gapless transitions without relying on JavaScript timing.

Crossfade is implemented internally but has no UI setting yet.

### Known limits

Tracks are downloaded and decoded in full before playback, so long files start slowly and consume roughly 600 MB per hour of stereo PCM. The engine retains only the current and next tracks.

## Developing

Run the Go API and Vite in separate terminals; Vite proxies `/api` to the server.

```sh
cd server && go run ./cmd/rhythm --music ~/Music   # terminal 1
cd web && pnpm install && pnpm dev                 # terminal 2, then localhost:5173
```

Everything CI checks, you can run locally:

```sh
make test        # go test, -race, vet, mod tidy -diff; vitest, tsc, prettier
make fmt         # gofmt + prettier
make build       # build the client, embed it, compile one binary
make docker
```

### Gapless audio acceptance test

Most engine tests use a fake audio context under jsdom. The gapless acceptance test runs in headless Chromium and uses `OfflineAudioContext` to decode and schedule two adjacent WAV fixtures through `WebAudioEngine`. It then checks the rendered PCM for gaps, overlaps, discontinuities and frame misalignment.

```sh
cd web
pnpm exec playwright install chromium   # once
pnpm test:audio
```

The fixtures are generated in memory from `web/src/engine/testing/gaplessFixture.ts`; no setup is required before running the test. To write them to disk for listening or inspection:

```sh
cd web && pnpm fixtures:gapless [outDir]   # defaults to a temp directory
```

The fixtures use PCM WAV so the test can isolate scheduling behavior without encoder delay or padding. Gapless AAC/m4a is not covered.

`make build` copies `web/dist` into `server/internal/webui/assets`, which is generated and git-ignored. A bare `go build` still works if you skip that step; the binary just serves a placeholder page telling you to build the client.

## API

| Endpoint                      | What it returns                                 |
| ----------------------------- | ----------------------------------------------- |
| `GET /api/roots`              | Configured libraries and their filesystem roots |
| `GET /api/browse?path=&root=` | One directory: subfolders and audio files       |
| `GET /api/stream/{id}`        | File bytes, with full HTTP range support        |
| `GET /api/art/{id}?size=`     | Cover art, resized and cached                   |

Artwork is read from embedded tags, then common sidecar images. Missing artwork returns `404`; supported sizes are 64, 160, 320, and 640 pixels. Thumbnails are cached under `<data-dir>/art` and invalidated when their source files change.

Responses are JSON, and the client validates every one of them against a schema before using it.

A file id looks like `<rootID>:<base64url(relative path)>`. Qualifying it by root means two libraries containing the same relative path stay two different files. Paths get canonicalised and confined to their root, and symlinks are resolved before that check happens, so one pointing outside your library is neither listed nor served.

## Layout

```
server/          Go: cmd/rhythm, internal/{library,stream,art,api,webui}
web/             React 19 + Vite + TypeScript
web/src/engine/  The audio engine: plain TypeScript, no React imports
web/src/stores/  Per-player Zustand stores backed by pure queue transitions
```

The engine has no React dependency; queue and scheduling transitions remain pure TypeScript.

Queue state lives in a per-player Zustand store, while playback state remains authoritative inside the engine.

The reasoning behind these choices, and what's deliberately not built yet, is in [rhythm-build-plan.md](rhythm-build-plan.md).

## License

AGPLv3. See [LICENSE](LICENSE).
