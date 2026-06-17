# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2026-06-17

✨ Added

- Release is now gated by a clean `npm ci && npm run build && npm test` run before the tag is pushed — a broken build or failing tests will abort the release rather than leaving an orphaned tag.

🔧 Changed

- CLI smoke tests now run from an isolated temp directory instead of the repo root, eliminating live network calls and flaky timeouts under load.
- `.mint.toml` trimmed to only the settings that differ from mint's built-in defaults, removing the commented-out documentation scaffolding.

## [0.3.1] - 2026-06-15

✨ Added

- `mint` is now the release driver — the `release` script is a thin shim that delegates to `mint release`, replacing the previous self-contained bash implementation.
- `.mint.toml` configures the release pipeline, including AI model selection, diff exclusions for workflow/tooling artifacts, and lifecycle hooks.
- `list`, `remove`, and `update` commands now display an `agntc <command>` intro banner at the start of each command.

🗑️ Removed

- `CURSOR-DRIVER-RESEARCH.md` has been deleted now that Cursor driver research is complete.


## [0.2.1] - 2026-03-31

- Fix collision/unmanaged prompt duplication on arrow-key toggle by extracting file lists into static p.note() panels
- Add shared formatFileList utility with 10-file truncation and summary line
- Add quick-fix work type with scoping pipeline (scoping → implementation → review)
- Add discussion perspective, review, and synthesis background agents
- Add investigation synthesis validation agent
- Add verification workflow for mechanical changes (baseline → change → verify)
- Add compliance self-check step to all processing skills
- Upgrade agentic-workflows dependency to v0.2.0


## [0.0.5] - 2026-02-24

- Bump Node.js to v24 in publish workflow


## [0.0.4] - 2026-02-24

- Add npm publish workflow
- Document init command


## [0.0.3] - 2026-02-24

- Move workflow permissions to top level with write access
- Checkout main branch explicitly on tag trigger


## [0.0.2] - 2026-02-24

- Remove environment from publish workflow


