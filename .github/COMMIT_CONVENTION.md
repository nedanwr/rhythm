# Git Commit Message Convention

> Adapted from [Angular's commit
> convention](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md),
> with one deliberate change: the scope is the **project surface**, not a single
> feature. Rhythm has a Go server, a first-party web UI, and eventually a
> desktop shell; scoping by surface keeps history legible as the project grows.

## Message format

All commit messages must match:

```
/^(revert: )?(feat|fix|docs|style|refactor|perf|test|build|ci|chore|types)\(.+\)!?: .{1,72}/
```

Full structure:

```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

> [!IMPORTANT]
> The header (`<type>(<scope>): <subject>`) is mandatory, and so is the scope.
> Body and footer are optional. Repo-wide and root changes use the `repo` scope.

## Type

Required. Determines changelog categorization.

| Type       | Use for                                 | In changelog |
| ---------- | --------------------------------------- | ------------ |
| `feat`     | A new feature                           | ✅           |
| `fix`      | A bug fix                               | ✅           |
| `perf`     | A performance improvement               | ✅           |
| `docs`     | Documentation only                      | —            |
| `style`    | Formatting/whitespace, no logic change  | —            |
| `refactor` | Code change that neither fixes nor adds | —            |
| `test`     | Adding or correcting tests              | —            |
| `build`    | Build system or dependencies            | —            |
| `ci`       | CI configuration and scripts            | —            |
| `chore`    | Other maintenance                       | —            |
| `types`    | Type definition changes                 | —            |

> [!NOTE]
> Breaking changes always appear in the changelog regardless of type.

## Scope — the project surface

Required. The scope names the project surface or package the change belongs to.
Current scopes:

- `server` — Go server, API handlers, library scanning, streaming, embedded UI
- `web` — React/Vite web player and TypeScript client code
- `desktop` — Tauri desktop shell and native desktop integration
- `engine` — shared playback engine logic, especially code reused by web/desktop
- `repo` — repo-wide tooling, docs, config, CI, build scripts, or root files

Add a new scope here when a new first-class package or surface is introduced.
A commit that genuinely spans multiple surfaces uses the `repo` scope, but prefer
splitting it into per-surface commits where practical.

## Subject

Required. Maximum 72 characters.

- Imperative, present tense: "add", not "added" or "adds".
- No capitalization of the first letter.
- No trailing punctuation.

## Body

Optional. Imperative, present tense. Explain the motivation for the change and
contrast it with previous behavior.

## Footer

Optional. Use it to:

- Reference closed issues, e.g. `Closes #123`.
- Document breaking changes (see below).

## Breaking changes

Add `!` before the colon in the header and describe the change in the footer:

```
feat(server)!: change stream ids to be library-root relative

BREAKING CHANGE: stream URLs now use library-root-relative ids instead of
absolute paths. Clients must resolve ids through the library API before playing.
```

## Reverts

A revert commit begins with `revert: ` followed by the header of the reverted
commit. The body should state which commit is reverted:

```
revert: feat(web): add queue drawer

This reverts commit <hash>.
```

## Examples

```
feat(web): add folder browser playback controls
fix(server): confine browse paths to the music root
perf(server): stream tracks with range requests
docs(repo): document the phase build plan
refactor(engine): isolate gapless scheduler state
test(server): add range streaming regression coverage
build(repo): embed the web build in the Go binary
chore(repo): bump the pinned Go toolchain
types(web): add zod schema for browse responses
feat(desktop)!: require explicit local library selection
```
