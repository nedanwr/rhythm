# Rhythm — Build Plan

**What it is:** Open-source, self-hosted music streaming. Fast Go server, first-party web UI, desktop app. Vertically integrated — we own every client surface. No third-party app ecosystem, no Subsonic-as-foundation.

**Guiding order:** files → playback → polish → metadata → everything else. Each phase ships something usable.

---

## Architecture (decided up front, built incrementally)

```
rhythm/
├── server/                 # Go
│   ├── cmd/rhythm/         # main; embeds web UI via embed.FS
│   ├── internal/
│   │   ├── library/        # filesystem walker, watcher, index
│   │   ├── stream/         # range-request file serving, later transcode
│   │   ├── api/            # HTTP + WebSocket handlers (middleware-ready)
│   │   └── store/          # SQLite index (files+tags remain source of truth)
├── web/                    # React 19 + Vite + TS (also the desktop app's UI)
│   ├── src/
│   │   ├── engine/         # Web Audio engine — plain TS, no React imports, the crown jewels
│   │   ├── routes/         # TanStack Router
│   │   ├── components/
│   │   └── stores/         # Zustand / useSyncExternalStore bridges to engine
└── desktop/                # Tauri shell (Phase 4)
```

**Locked-in decisions:**

- **The server serves bytes; decoding is the client's job wherever a client can do it.** Tiered:
  1. **Direct decode** — formats the browser handles natively (FLAC, MP3, AAC, Vorbis, Opus, WAV): straight into the Web Audio pipeline. Note m4a is a container: AAC-in-m4a is tier 1 everywhere, ALAC-in-m4a is tier 1 on Safari only, tier 2 elsewhere — routing keys off the _codec_ (from the library index), not the extension. Native decode is attempted first regardless, so a browser that can do it keeps its hardware path; the codec decides only where to go when it can't.
  2. **In-browser decode** — formats the browser can't (ALAC, DSD, TrueHD core, WMA): raw file fetched, decoded client-side to bit-exact PCM, same pipeline. Zero server CPU, zero quality loss. ALAC shipped as a plain TypeScript port of Apple's reference decoder (no toolchain, no artifact, sample-exact against ffmpeg); the remaining formats still point at WASM (symphonia-wasm preferred, ffmpeg.wasm fallback). Design for **incremental/chunked decode** rather than whole-file-then-decode — a 400 MB DSD file must start playing before it finishes downloading; this constraint is a main reason symphonia-wasm is preferred for the rest.
  3. **Server compatibility decode** — the exception that had to exist: E-AC-3 (the carrier for Atmos music), AC-3, AC-4 and DTS have no browser decoder and no practical in-browser one either, so the server decodes them to FLAC and the client takes it from tier 1. Narrow by construction — an explicit codec list, never a fallback for anything that failed to decode — and lossless with respect to the decoded PCM. Without it, an Atmos library is silent in every web client. See Phase 5.
  4. **Native engine (desktop, Phase 4+)** — Rust decode (symphonia/ffmpeg) with exclusive-mode output (WASAPI/CoreAudio), and **bitstream passthrough** for TrueHD/Atmos & DTS-HD: bits go untouched over HDMI to an AVR that decodes them. The Kodi approach — the only way Atmos survives, and a feature no OSS music server has.
  - Known browser-environment limit (not a Rhythm limit): browsers output PCM through the OS mixer, so Atmos object metadata can't survive in any web client. Web playback of TrueHD yields the lossless core; full Atmos is the desktop app's job.
  - Lossy transcoding (FLAC→Opus) exists later only as an explicit opt-in for bandwidth-constrained remote streaming — never the default, never local.
- Files + tags are the source of truth. SQLite is a disposable index — delete it, rescan, identical result.
- One frontend codebase serves web and desktop: React 19 + Vite SPA — no SSR, no Node runtime, ever. The Go binary is the only server.
- The audio engine is plain TypeScript with zero React imports; UI subscribes via `useSyncExternalStore`. Engine must stay swappable (Rust/cpal backend in Tauri later).
- First-party JSON/WebSocket API. Subsonic shim is a _maybe-later translation layer_, never the native surface.
- Server binds `127.0.0.1` by default. `--host` flag to expose. Real auth is Phase 5, but every handler goes through a middleware chain from day one so auth slots in without a rewrite.

---

## Phase 0 — Skeleton (a weekend) — ✅ DONE

Goal: `./rhythm --music ~/Music` serves a page that lists files and plays one when clicked. (The flag creates one implicit default library — see Project setup; the schema supports Plex-style multi-root tagged libraries from day one.)

- Go server: chi or stdlib mux, single binary, `embed.FS` for the UI.
- `GET /api/browse?path=` — directory listing (dirs + audio files only; extension whitelist: flac, mp3, m4a/alac, ogg, opus, wav, aiff, dsf/dff, mka/thd, dts, wma — listed even before all are playable).
- `GET /api/stream/{id}` — serve file with proper `Accept-Ranges` / HTTP range support (`http.ServeContent` gives this free). Range support is non-negotiable — seeking depends on it.
- Path safety: canonicalize + confine every request inside the music root. This is the one security thing Phase 0 must get right.
- SPA fallback middleware: non-`/api` unknown paths serve `index.html` so client-side routes survive refresh/deep-links.
- Web UI: Vite + React scaffold (TanStack Router wired in even with one route), file tree pane + a plain `<audio>` element. Ugly is fine. Playing is the point.

**Done when:** you browse your real library and play a FLAC in the browser. ✅

## Phase 1 — A real player (1–2 weeks)

Goal: replace `<audio>` with the Rhythm engine. This is the riskiest, most differentiating work — do it before it has anything to hide behind.

- **Web Audio engine:** fetch → decode → `AudioBufferSourceNode`, scheduled sample-accurately against `AudioContext.currentTime`.
  - Gapless: pre-fetch and pre-decode the next track, schedule its start at exactly the current buffer's end. Known refinement: AAC/m4a encoder delay & padding (`iTunSMPB`) must be trimmed manually — browsers don't honor it via `decodeAudioData` — or iTunes-era albums click at track boundaries. Not day one, but on the list; it's the difference between "gapless" and gapless.
  - Crossfade: two sources, equal-power gain ramps. Off by default, per-user setting later.
  - Seek: re-schedule from offset. Volume: master `GainNode`.
- **Decode tiering in the engine:** capability-detect per format; browser-native decode where supported, WASM decoder path for the rest (can land as Phase 1.5 — architecture in from day one, exotic codecs added incrementally). Decode strategy is invisible above the engine interface.
- **Effects insert architecture:** engine graph is `source → [inserts] → master gain → destination` from day one. EQ, ReplayGain, future loudness normalization/crossfeed are all inserts — no special cases, no retrofit. Engine contract carries a DSP settings surface (band gains, preamp, bypass) so web and native engines honor the same settings.
- Queue model in the frontend: ordered list, current index, next-up pre-decode. Keep it a pure state module — it will outlive every UI around it.
- Keyboard controls (space, arrows) + `MediaSession` API so OS media keys and lock-screen controls work in-browser.
- Memory discipline: decoded PCM is huge (a 60-min FLAC ≈ 600 MB decoded). Hold at most current + next buffers; for very long tracks, chunked decode is a later refinement — cap and document for now.

**Done when:** an album with a continuous mix (live album, DJ mix) plays with zero audible gaps.

## Phase 2 — Library index & watcher (1 week)

Goal: stop hitting the filesystem per-request; know what changed.

- Walker builds a SQLite index: path, size, mtime, format, **codec** (container ≠ codec — an .m4a may be AAC or ALAC; read the MP4 `stsd` box to tell), duration. Duration via lightweight header parsing (`go-flac`, `id3v2` header only — this is _not_ the metadata phase, just enough to show track length). Codec in the index lets clients pick their decode tier by lookup instead of probing.
- `fsnotify` watcher → incremental updates. Full rescan = idempotent rebuild.
- `GET /api/library/tree`, plus dead-simple filename search.
- **Play state persistence:** queue contents, current track, position, shuffle/repeat serialized server-side per user (the queue store is a pure state module precisely so this is a serializer, not a redesign). Close the tab, open the desktop app, resume exactly where you were. Rides the same WebSocket that later powers multi-device sync.
- **Play history from day one:** every completed play logged (`user, track_id, timestamp, duration_played`). Costs a table now; it's the raw material for play counts, recently-played, smart playlists, and the Phase 5+ intelligence layer — and makes Last.fm/ListenBrainz scrobbling (a guaranteed early community demand) a trivial forwarder later. History not recorded is gone forever.
- **Config strategy:** flags > env vars > TOML config file > defaults, plus a single `--data-dir` containing the SQLite index, art cache, and (later) transcode cache in a documented layout. Docker users get env vars, systemd users get the file, nobody files "where does Rhythm store things" issues.
- WebSocket channel: scan progress, library-changed events. This socket becomes the backbone for now-playing sync later.

**Done when:** 50k-file library cold-scans in seconds, file changes appear without restart.

## Phase 3 — UI worth using (1–2 weeks)

Goal: something you'd screenshot for the README.

- Proper layout: sidebar (folder tree), main pane, persistent bottom player bar — queue drawer, seek bar with buffered indicator.
- Embedded cover art: extract from tags server-side, `folder.jpg` fallback, cached thumbnails endpoint.
- Design system decided _now_, not retrofitted:
  - Tailwind v4 tokens in an `@theme` block — real Rhythm palette, radii, spacing. shadcn CSS variables mapped to these from init, so the default shadcn look never ships.
  - Geist from the `geist` npm package, imported through Vite so the woff2 files bundle into the build — everything stays local/offline, no font CDN. Geist Mono + `tabular-nums` for durations, bitrates, sample rates.
  - shadcn/Radix for the commodity primitives: context menus (right-click on tracks), dropdowns, dialogs, tooltips, slider (seek/volume). Fully custom builds for the identity components: player bar, queue drawer, track rows, album grid.
- **Equalizer (core pillar — one of the project's founding motivations):**
  - 10-band graphic EQ (ISO bands, `BiquadFilterNode` chain in the insert slot) + preamp. Default state: **no EQ, pure bypass** — signal purity is the out-of-box experience.
  - **Resolution cascade — strictly user-authored, first match wins:** (1) song-specific override → (2) album override → (3) user's genre→curve mappings → (4) user global default → (5) flat/bypass. **Rhythm never assigns EQ on its own** — no auto-population, no suggestions; every tier exists only if the user created it. Per-user, persisted server-side, follows the user across all clients. Schema is scope-shaped from day one: `(user, scope, scope_ref, curve)` with scope ∈ `global | genre | album | song` — the genre/album tiers land in Phase 5 only because tags/album entities require the metadata phase, not because they're "smart"; they're plain user-edited settings. Song overrides are set from the now-playing screen, album overrides from the album page — tweak-while-listening entry points are what make the system actually get used (e.g. one psych-rock track can override to the R&B curve while the genre mapping keeps the rest of rock on Rock; a whole loudness-war-era album can be tamed with one setting).
  - **Ship familiar genre presets** (R&B, Rock, Pop, Jazz, Classical, Bass Boost…) as visible, _editable_ curves — the industry-standard shapes users know from every platform, tuned to Rhythm's own judgment rather than replicating any one service. They're vocabulary and starting points, not hidden magic. Any edit saves as a user preset; presets are just named curves in the same store. Parametric mode (exposed freq/Q per band) is a later enthusiast feature.
  - Engine requirements: curve changes ramp via `setTargetAtTime` (~50–100 ms) — never hard-jump biquad gains mid-signal (audible pop), and curves swap routinely at track boundaries in this design. Now-playing UI always shows which EQ is active and why ("Song override" / "Genre rule: R&B" / "Global") — an invisible cascade is a support nightmare.
  - **Gain staging & headroom (purity by default, safety once DSP is engaged):** with no EQ/DSP active, playback is untouched — no hidden headroom, no normalization, the file as mastered. When a curve is active: **auto-compensating preamp** = −(largest positive band gain), applied automatically, displayed live in the UI ("Auto headroom: −6 dB"), user-overridable and disableable. Rationale: Web Audio's graph is float32 and won't clip internally, but samples >1.0 hard-clip at the output — boosted EQ on loudness-war masters (peaks at 0 dBFS) _will_ clip without this. A **lookahead peak limiter** sits as the final insert as backstop (inter-sample peaks, stacked DSP); it is bypassed whenever the chain is bypassed and can be disabled on principle. Master volume sits _after_ the limiter in the graph.
  - **Loudness normalization is a separate, opt-in feature (Phase 5)** — never conflated with EQ headroom: ReplayGain 2.0 / LUFS analysis during library scan, per-track or album-gain to a user-chosen target. Default −14 LUFS (the common streaming-industry convention), fully configurable, with platform reference points shown in settings (Spotify −14, Apple ≈ −16, Tidal −14, EBU broadcast −23) as _orientation, not aspiration_ — Rhythm matches no one's sound by default. Off by default: streaming services turn loud masters down to their loudness targets; Rhythm plays the master as-is unless the user decides otherwise.
- Dark mode default. It's a music app.

**Done when:** you'd voluntarily use it over whatever you use today, for local listening.

## Phase 4 — Desktop app (1 week)

Goal: same UI, native shell, download-a-binary distribution.

- Tauri wrapping `web/`. Two modes: connect to remote Rhythm server, or spawn the bundled Go server against a local folder ("iTunes but not dead" mode).
- System tray, native media-key integration.
- Native audio engine (same `RhythmEngine` contract): Rust decode via symphonia streaming over HTTP ranges, gapless queue, in-process 10-band EQ + preamp (auto-headroom honored), cpal/CoreAudio output.
- Engine refinements: rubato windowed-sinc resampling (matched sample rates pass through bit-exact; per-track filter-delay trim + duration cap keep gapless joins tight), native lookahead limiter (port of the web worklet kernel — −1 dB ceiling, 3 ms lookahead, engages only with DSP), BS.775 multichannel→stereo downmix, and equal-power native crossfade. DSP kernels unit-tested under `cargo test`.
- ❌ **NOT DONE — bit-perfect output & passthrough:** exclusive-mode output (WASAPI exclusive / CoreAudio hog mode), and **bitstream passthrough** of TrueHD/Atmos & DTS-HD over HDMI to AVRs — the flagship audiophile feature; passthrough is Windows/Linux work (macOS has no OS-level TrueHD passthrough). Rule stands: **passthrough and DSP (EQ/ReplayGain) are mutually exclusive by definition** — passthrough mode disables the insert chain and the UI says so explicitly; never silently no-op the EQ.

**Done when:** non-self-hosting friend downloads a .dmg/.exe, points it at a folder, plays music.

## Phase 5 — Now it's a server (ongoing)

Only after the above works:

- **Auth & multi-user accounts (Plex-style):** single-user token first, then users/sessions — each account owns its EQ cascade, presets, playlists, and play state. Middleware chain from Phase 0 means this is additive.
- **Opt-in remote transcoding:** ffmpeg shell-out, FLAC→Opus profiles strictly for bandwidth-constrained remote streaming; off by default, never in the local playback path. Cache keyed by file-hash+profile.
- **Every codec an `.m4a` can hold — AAC, ALAC, and Dolby (E-AC-3/Atmos):** the extension whitelist has listed `.m4a` since Phase 0, but a container is not a codec, and the three formats hiding behind that extension need three different decode paths. A library of Atmos albums was silent; this makes it play.
  - **Three tiers, chosen by codec before the fetch, not by failed decode.** AAC is native everywhere (tier 1). ALAC is native on Safari only, so it ships an in-tree TypeScript decoder — an MP4 demuxer plus a port of Apple's reference decoder (Apache-2.0), verified sample-exact against ffmpeg across 16/24-bit × mono/stereo, lazy-loaded so a FLAC library never pays for it (tier 2). This lands the Phase 1.5 tier-2 slot with plain TS rather than the WASM build originally sketched: no toolchain, no artifact, same lossless result. Native decode is still attempted first, so Safari keeps its hardware path.
  - **Compatibility decode for what no browser can decode** (E-AC-3, AC-3, AC-4, DTS, TrueHD): the server decodes to FLAC with the ffmpeg already required for loudness, and the client handles the result natively (tier 3). This is the one place the server touches audio in the playback path, and it is deliberately narrow — an explicit codec list, never a catch-all on decode failure, so a corrupt FLAC still surfaces as a corrupt FLAC. Distinct from remote transcoding above: that trades quality for bandwidth by choice, this exists because the alternative is silence.
  - **Cached on disk, not piped.** A pipe has no length and no ranges, and both clients need them — the desktop engine refuses a source it cannot seek. Keyed on path+size+mtime+channels, written `.part` and renamed so a cancelled request can't leave a valid-looking truncation, held open across the response so eviction can't sweep the file being served, LRU-evicted against a byte budget. `Last-Modified` comes from the source, since the cache entry's mtime moves on every hit to drive that eviction. Stereo by default: the graph downmixes to the output device anyway, and 5.1 float PCM in a browser costs three times the memory for the same result.
  - **Atmos does not survive this, and the plan should not pretend otherwise.** Decoding JOC yields the 5.1 core; the height objects only exist over bitstream passthrough to an AVR — the Phase 4 native-engine feature, not something a browser can be talked into.
  - **The index tells the truth about codecs.** The MP4 walk reads the audio track (a video/artwork track's `VisualSampleEntry` was being read for sample rate), scopes the `frma` protection lookup to its own sample entry (one entry's declared format was relabelling another's), names `ec-3`/`ac-3`/`ac-4`/`dts` instead of defaulting to "aac", and reads ALAC bit depth and sample rate from the magic cookie — the sample entry's 16.16 field cannot express 96 kHz. A `probe_version` column re-probes rows written by an older parser, so improvements reach existing libraries instead of only fresh ones.
  - **A track that won't play says why.** Decode failures name the codec in words a listener recognizes ("Dolby Digital Plus (Atmos) can't be decoded in the browser") in the player bar and the console, instead of a silent transport that reads as a broken app. The desktop engine falls back to the same decode endpoint when symphonia has no decoder (compile-checked; not yet exercised in a packaged shell).
- **Metadata proper:** full tag parsing, artist/album browsing, MusicBrainz IDs, the classical-music and multi-artist edge cases. Mine Navidrome's issue tracker with an agent to build the test corpus before writing the scanner v2.
- **Genre & album EQ tiers** (unlocked by metadata, since tags/album entities don't exist until then): a user-edited genre→curve settings table plus per-album overrides from the album page, resolving between song overrides and the global default. Empty by default; Rhythm never populates them. "My rock gets Rock, my R&B gets R&B, that one dark-mastered album gets fixed — because I said so, once" — a second flagship feature alongside passthrough; no mainstream player does this well.
- **Loudness analysis & normalization:** ReplayGain 2.0 / LUFS scan during library analysis; opt-in per-track/album-gain to a configurable target (see EQ pillar). Feeds the same insert chain.
  - **Server measures, never decides.** Pure-Go BS.1770-4 meter (K-weighting derived per sample rate, two-stage gating), cross-checked against libebur128 to ≤0.15 LU on steady tone, gated quiet tails, and noise. Stores LUFS + peak — never a gain, because a gain only exists relative to a target and the target is a playback setting.
  - **Cheapest pass first:** existing ReplayGain/R128 tags (FLAC Vorbis comments, ID3v2 TXXX, Opus Q7.8) cost a header read and run automatically after every scan. The ffmpeg decode pass is expensive, so it only runs when a person asks for it in Settings → Loudness — no server flag; clicking the button is the consent.
  - **Clients resolve the gain** against the user's target + preamp + clipping prevention, and apply it per source in both engines — ahead of the crossfade, so during a blend each track carries its own level and album relationships survive. Unanalyzed tracks play at unity: a level is never invented.
  - **Album = directory** until the metadata phase, energy-weighted by duration so a 30-second interlude doesn't pull the album gain like a 10-minute closer. Tag-provided album gains outrank the heuristic; a track that can never be measured doesn't hold its album hostage.
  - **Unmeasurable files are recorded, not retried forever** (keyed to size+mtime, so a repaired file re-queues itself), named in settings with ffmpeg's own reason, and retried on request. They stay playable and unnormalized, marked with a quiet "No RG" label — Rhythm doesn't refuse to play a file because it couldn't measure it.
  - Known gap: files ffmpeg's demuxer won't read (e.g. an mp4 track carrying multiple sample descriptions) stay unmeasured, and some of those don't play in the browser engine either. Neither is a DRM verdict, and neither blocks the rest of the library.
- **Scrobbling:** Last.fm / ListenBrainz forwarding from the play-history log — small feature, loud community demand.
- Playlists, multi-device now-playing sync, smart features (the Plexamp-tier intelligence layer — the actual endgame).

---

## Stack summary

| Piece        | Choice                                                     | Why                                                                                        |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Server       | Go, stdlib-heavy, SQLite (modernc, no cgo)                 | single static binary, easy cross-compile                                                   |
| Frontend     | React 19 + Vite + TypeScript (SPA, no SSR)                 | shared web/desktop UI; max agent leverage                                                  |
| Routing/data | TanStack Router + TanStack Query (+ Virtual for big lists) | type-safe routes, API caching, no server runtime                                           |
| App state    | Zustand / `useSyncExternalStore` against engine stores     | fast-ticking playback state without re-render pressure                                     |
| Styling      | Tailwind v4 (CSS-first `@theme` tokens)                    | velocity without default-template look                                                     |
| Font         | Geist + Geist Mono via the `geist` npm package             | clean UI grotesque; mono + `tabular-nums` for times/bitrates; bundled locally, no font CDN |
| Components   | shadcn/Radix primitives, aggressively restyled             | free a11y for menus/dialogs/sliders; Rhythm tokens from day one, never default theme       |
| Audio        | Web Audio API engine (custom, plain TS, outside React)     | gapless/crossfade impossible with `<audio>`; swappable for Rust backend in Tauri           |
| Desktop      | Tauri                                                      | tiny binaries, Rust escape hatch for audio later                                           |
| Watcher      | fsnotify                                                   | standard                                                                                   |
| Tags (light) | go-flac / id3 header parse                                 | duration only, for now                                                                     |

## Type strategy

No Effect, no fp-ts — plain strict TypeScript. Complexity budget goes to the product, not a programming model, and agents produce their best code in vanilla strict TS.

1. `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
2. **Go generates the contract:** API types defined once in Go, TypeScript generated from them (tygo or OpenAPI codegen). Server/client drift = build failure. This is the highest-value typing investment in the project.
3. **Zod at trust boundaries only:** every `/api` response and WebSocket message is schema-parsed on entry. Inside the boundary, plain typed TS — no runtime validation ceremony on internal code.
4. Discriminated unions for all event/message types (engine events, WS messages); exhaustive `switch` with `never` checks.

## Project setup (decided)

- **License: AGPLv3.** Decided day one — relicensing later needs every contributor's consent. Protects against hosted-service freeloading; standard for self-hosted infra (Navidrome, Jellyfin, Grafana precedent).
- **Libraries schema from day one:** `library → roots → files` (library has name/type/tags, contains multiple filesystem roots; files store root_id + relative path, never absolute strings). Phase 0's `--music [lib]` creates one implicit default library. Plex-style named/tagged multi-root libraries later become UI over existing structure, not a migration.
- **Distribution:** GoReleaser + GitHub Actions from Phase 0 — cross-platform static binaries _and_ a Docker image (scratch/distroless, ~10-line Dockerfile) with checksums. Self-hosters will demand Docker within a week of any public post; ship both from the first release.
- **Engine testability:** scheduler logic stays pure (track lengths + clock in, schedule times out — unit-testable without audio). Scheduler, queue, and DSP unit tests: EQ headroom math (`autoHeadroom`/`effectivePreamp`/`curvesEqual`) and the limiter worklet kernel (ceiling, lookahead delay, linked stereo reduction, release) run under vitest without an audio graph. Deliverable: a generated test corpus — sine sweeps with known phase at boundaries so gapless joins are _verified_ via `OfflineAudioContext` sample-continuity checks, not by ear — plus codec-matrix fixtures (AAC, ALAC, FLAC, DSD, TrueHD samples).
- **Telemetry: none, ever.** No opt-out analytics, no phone-home, no crash reporting. Stated explicitly in the README — table stakes for this audience.
- **Naming:** "Rhythm" is the working title; verify GitHub org, domain, and package registries before anything goes public (Rhythmbox adjacency + generic-term squatting risk). Renaming after launch is the worst-case timing.

## Principles

0. **Familiar, not derivative.** No streaming platform is the reference — not Spotify, not Apple, not anyone. Standard interaction grammar (play, queue, seek) so it feels immediately usable; Rhythm's own judgment everywhere the platforms compromised. Platform behaviors may appear in settings as labeled reference points, never as silent defaults.

1. **The player engine is the product.** Everything else is furniture.
2. Files are truth; the database is cache.
3. Every phase ends in something you personally use.
4. No feature enters before its phase. Metadata especially — it's a tar pit and it's Phase 5 for a reason.
