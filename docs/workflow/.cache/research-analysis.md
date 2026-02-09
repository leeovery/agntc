---
checksum: 241a89c2bf4430a93480bc48ada54c67
generated: 2026-02-09T19:45:00
research_files:
  - exploration.md
  - plugin-init-scaffolding.md
---

# Research Analysis Cache

## Topics

### 1. Core Architecture — Repo Modes, Asset Discovery, and Manifest
- **Source**: exploration.md (lines 72-181)
- **Summary**: Convention-based discovery, unit vs collection repo modes with auto-detect, and `.agntc/manifest.json` for tracking installs. These three are tightly coupled — the manifest shape depends on how modes work, which depends on how assets are discovered.
- **Key questions**: Manifest shape for unit vs collection tracking, auto-detect heuristics, edge cases in convention-based scanning, per-plugin tracking within collections.

### 2. Multi-Agent Support — Detection, Compatibility, and Asset Routing
- **Source**: exploration.md (lines 83-256, 362-378)
- **Summary**: Deeply asymmetric landscape — Claude is richest, Codex shares skills standard, everyone else is rules-only. Need strategy for detecting installed agents, plugin compatibility declaration (`agntc.json`), and routing assets to the right target dirs.
- **Key questions**: Translation vs copy-what-maps, per-agent dirs in plugins vs single set routed by tool, `agntc.json` schema, detection heuristics, depth of non-Claude support.

### 3. CLI Commands and UX — Add, Remove, Update, List
- **Source**: exploration.md (lines 183-201, 413-474)
- **Summary**: All four commands share patterns — manifest-driven, interactive with @clack/prompts, need conflict/error handling. Add flow mocked for unit/collection/re-add. Remove is manifest-driven deletion. Update uses smart SHA comparison. List is unexplored.
- **Key questions**: Conflict handling (force flag?), update automation approach, remove parameterization, error states, exact flow details.

### 4. Naming and Identity
- **Source**: exploration.md (lines 382-409)
- **Summary**: `agntc` is the frontrunner — dev shorthand for "agentic", npm available. Other candidates: `noesis`, `imbuo`, `skillpak`.
- **Key questions**: Final name decision.

### 5. Deferred Items Triage
- **Source**: exploration.md (lines 478-490)
- **Summary**: Several topics explicitly deferred: GitHub shorthand parsing, error handling UX, existing plugin migration, `agntc.json` schema, file path collisions across plugins, asset rename/delete between versions, partial failure atomicity.
- **Key questions**: Which to pull into discussion now vs leave for spec phase?

### 6. Plugin Init Scaffolding
- **Source**: plugin-init-scaffolding.md (lines 1-81)
- **Summary**: `npx agntc init` command for plugin authors. Greenfield + brownfield modes with auto-detect and confirm. Minimal questions (type + agents), scaffolds all convention dirs. Author-facing, not consumer-facing.
- **Key questions**: Exact question flow, starter files content, collection per-plugin scaffolding, bare skill shortcut flag.
