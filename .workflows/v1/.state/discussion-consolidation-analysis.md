---
checksum: ec27f59073a6353c2d8b179e79cc4100
generated: 2026-02-09T21:38:00Z
discussion_files:
  - cli-commands-ux.md
  - config-file-simplification.md
  - core-architecture.md
  - deferred-items-triage.md
  - multi-agent-support.md
  - naming-and-identity.md
  - plugin-init-scaffolding.md
---

# Discussion Consolidation Analysis

## Recommended Groupings

### Core System
- **core-architecture**: Defines the plugin/collection model, agntc.json as boundary marker, manifest shape (flat, keyed by install path), convention-based asset discovery with bare skill fallback, nuke-and-reinstall update strategy.
- **multi-agent-support**: Extends the foundation with driver/strategy pattern, agent detection, asset routing config, and the `agents` field in agntc.json. Defines the two-agent model (Claude, Codex) and three asset types (skills, agents, hooks).
- **config-file-simplification**: Directly revises decisions from both core-architecture and multi-agent-support — eliminates `type` field, makes `agents` required, drops convention fallback, drops collection as a declared type.
- **cli-commands-ux**: Defines all four consumer-facing commands (add, remove, update, list) — full flows from argument parsing through manifest write, agent selection UX, conflict handling, error strategy, and the interactive list dashboard.
- **deferred-items-triage**: Resolves edge cases that manifest directly in CLI command flows — file path collisions (hard block during add), existing plugin migration (handled by add's overwrite), asset rename/delete between versions (handled by update's nuke-and-reinstall).

**Coupling**: The foundation (data model, detection, manifest, agent support) and the commands that operate on it are inseparable for implementation. config-file-simplification revises decisions across both foundation and CLI discussions. Building the core without the commands makes no sense — they're the primary consumer.

### Plugin Authoring
- **plugin-init-scaffolding**: Self-contained author-facing tool. Defines `npx agntc init` — type selection, brownfield detection, asset multiselect, agent multiselect, scaffolding per type (skill/plugin/collection), greenfield vs brownfield behavior.

**Coupling**: Depends on conventions from Core System (agntc.json shape, asset dirs, type model) but the init flow, question sequence, and scaffolding logic are independently plannable and buildable.

## Independent Discussions
- **naming-and-identity**: Establishes the tool name (`agntc`) and confirms it propagates cleanly across all touchpoints (CLI, npm, config files, manifest dir). Cross-cutting fact absorbed by other specs as needed.

## Analysis Notes
Custom groupings confirmed by user. Core Foundation and CLI Commands merged into a single "Core System" grouping — the commands are the primary consumer of the foundation, so building them together is more coherent.
