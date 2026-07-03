# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-07-03

🐛 Fixed
- Update checks for branch refs that look like version tags (e.g. `v4`) no longer misfire as a missing-tag error — the checker now asks the remote whether a ref is a branch or tag instead of guessing from its name.

## [0.3.2] - 2026-06-17

✨ Added

- Release gate runs a clean install, build, and test suite before tagging — a broken build can no longer produce an orphaned tag or GitHub release.

🔧 Changed

- CLI smoke tests now run from an isolated temp directory instead of the repo root, eliminating flaky network timeouts caused by live GitHub update-checks against the real manifest.
- `.mint.toml` trimmed to only keys that differ from mint's built-in defaults, removing the commented-out documentation scaffold.

## [0.3.1] - 2026-06-15

✨ Added

- Configure agntc releases via `.mint.toml` — sets the AI model, diff limits, excluded paths, changelog, and lifecycle hooks for the `mint` release tool.
- `list`, `remove`, and `update` commands now each print an `agntc <command>` intro banner at the start of their interactive flow.

🔧 Changed

- The `release` script is now a thin shim that delegates to `mint release`, replacing the previous self-contained bash implementation.

🗑️ Removed

- Deleted the Cursor driver research notes (`CURSOR-DRIVER-RESEARCH.md`) from the repository.

## [0.2.1] - 2026-03-31

✨ Added

- File conflict prompts now display the affected file list in a separate info panel before asking how to proceed — lists longer than 10 files are truncated with a count of remaining entries.

## [0.2.0] - 2026-03-27

✨ Added

- Cursor is now a supported agent — skills install to `.cursor/skills/` with the same `SKILL.md` format used by Claude and Codex.
- Agent multiselect auto-skips when a plugin declares exactly one agent and it is detected in the project.

🔧 Changed

- Collection installs now filter each plugin's agents to its declared set before copying, so a plugin declared for `claude`-only receives only the Claude driver even when multiple agents are selected globally.
- Collection plugins with no applicable agents after filtering are silently skipped rather than copied with a compatibility warning.
- Agent multiselect options are now scoped to the plugin's declared agents only; undeclared agents are excluded entirely instead of shown with a "not declared" hint.
- Undetected agents show a `(not detected in project)` label in the multiselect instead of a separate hint field.
- Per-plugin manifest entries now record only the agents actually installed for that plugin rather than the full selected set.
- `npx agntc` examples in the README updated to `npx agntc@latest` to avoid running a locally cached stale version.

## [0.1.0] - 2026-03-25

✨ Added

- Semver version constraints — `owner/repo` bare adds now auto-resolve the latest semver tag and store a `^major.minor.patch` constraint; `@^1.0` / `@~2.1` syntax installs the best matching tag within the range.
- `update` respects stored constraints — constrained plugins update to the best match within their range rather than pulling the absolute latest.
- Out-of-constraint info section — after update, any version newer than your constraint ceiling is listed so you know it exists without being forced onto it.
- `list` detail view shows constraint metadata and surfaces out-of-constraint versions with a "Change version" action that pins to an exact tag and clears the constraint.
- `semver` dependency added to resolve and compare version ranges.

🔧 Changed

- `list` plugin labels now render as `key  ^constraint → ref` when a constraint is stored, replacing the previous `key@ref` format.
- "Change version" action for constrained plugins fetches all remote tags (not just newer-than-current tags) so you can pick any version across the full history.
- Changing version always strips the constraint and pins to an exact tag.
- `update` never downgrades a constrained plugin — if the resolved best-match tag is older than the currently installed ref, the plugin is reported as up to date.
- Tag parsing extracted to shared `fetchRemoteTagRefs` / `fetchRemoteTags` helpers in `git-utils.ts`, removing duplicated ls-remote parsing across update-check and add flows.
- Test factory helpers (`makeEntry`, `makeFakeDriver`, `makeManifest`) consolidated into `tests/helpers/factories.ts`, eliminating repeated definitions across test files.

## [0.0.5] - 2026-02-24

🔧 Changed

- CI publish pipeline now runs on Node.js 24.

## [0.0.4] - 2026-02-24

Maintenance release — no notable source changes
## [0.0.3] - 2026-02-24

🔧 Changed

- CI publish workflow now checks out the `main` branch explicitly and elevates permissions to workflow scope — ensures release jobs have write access to repository contents.

## [0.0.2] - 2026-02-24

🔧 Changed

- The npm publish workflow no longer requires a named `npm` environment gate — publishing runs directly on tag push.

## [0.0.1] - 2026-02-24

Initial release.
