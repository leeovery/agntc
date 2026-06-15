# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-06-15

✨ Added

- `mint` is now the release driver — the `release` script is a thin shim that delegates to `mint release`, replacing the previous self-contained bash implementation.
- `.mint.toml` configures the release pipeline, including AI model selection, diff exclusions for workflow/tooling artifacts, and lifecycle hooks.
- `list`, `remove`, and `update` commands now display an `agntc <command>` intro banner at the start of each command.

🗑️ Removed

- `CURSOR-DRIVER-RESEARCH.md` has been deleted now that Cursor driver research is complete.

