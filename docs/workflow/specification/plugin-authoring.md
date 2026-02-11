---
topic: plugin-authoring
status: in-progress
type: feature
date: 2026-02-10
sources:
  - name: plugin-init-scaffolding
    status: pending
---

# Specification: Plugin Authoring

## Overview

`npx agntc init` is a plugin author tool that scaffolds new plugin repos for agntc. It asks minimal questions and generates the correct directory structure, `agntc.json`, and starter files so authors don't need to learn conventions manually.

This command is **author-facing, not consumer-facing**. It runs in the author's plugin repo — empty or existing — and produces a structure that's installable via `npx agntc add`.

## Command Signature

```
npx agntc init
```

No arguments. No flags. All configuration happens through interactive prompts using @clack/prompts.

## Greenfield vs Brownfield

The tool determines whether it's working with an empty or existing repo. This affects scaffolding depth, not type inference.

**Detection**: Does the current directory contain existing files/directories (beyond common root files like `.git/`)? If yes → brownfield. If no → greenfield.

- **Greenfield**: Scaffold full directory structure, `agntc.json`, and starter files for the chosen type
- **Brownfield**: Write `agntc.json` only — don't scaffold directories or starter files. The author already has their structure.

**`agntc.json` existence check**: If `agntc.json` already exists at root, warn "already initialized" and offer to reconfigure. This is a safety guard against double-init, not type detection.

## Type Selection

Always asked. No auto-detection from directory structure — the author knows what they're building.

```
What are you creating?

  ● Skill — a single skill (SKILL.md)
  ○ Plugin — skills, agents, and/or hooks that install together as one package
  ○ Collection — a repo of individually selectable plugins
```

The selected type determines the rest of the flow:

| Type | Subsequent Prompts | Scaffolding |
|------|-------------------|-------------|
| **Skill** | Agents multiselect | `agntc.json` + `SKILL.md` |
| **Plugin** | Asset multiselect → Agents multiselect | `agntc.json` + selected asset dirs + starter `SKILL.md` |
| **Collection** | Agents multiselect | Root `agntc.json` + example `my-plugin/` subdir |

## Asset Multiselect

Shown only for the **Plugin** type. Bare skills and collections skip this — bare skills have no asset dirs, collections scaffold a full example.

```
Which asset types will this plugin include?

  ◉ Skills
  ○ Agents
  ○ Hooks
```

- **Skills** is pre-selected by default
- Default action (enter/proceed with no changes) gives skills-only — zero friction for the common case
- Available asset types: `skills/`, `agents/`, `hooks/` (no `scripts/` or `rules/`)

Selected assets determine which directories are scaffolded (greenfield) or declared (brownfield).

## Agent Multiselect

Always shown, regardless of type. Lists all supported agents (currently Claude and Codex).

```
Which agents is this built for?

  ◉ Claude
  ○ Codex
```

**Pre-selection**: Detected agents are pre-selected. Detection uses the same strategy as the `add` command:

| Agent | Project Check | System Fallback |
|-------|--------------|-----------------|
| Claude | `.claude/` in project | `which claude` or `~/.claude/` |
| Codex | `.agents/` in project | `which codex` |

If no agents are detected, none are pre-selected — the author must explicitly choose.

The selected agents are written to the `agents` field in `agntc.json`. At least one agent must be selected — empty selection is not valid (the field is required and must be non-empty).

## Scaffolding Output

### Skill (Bare Skill)

**Greenfield:**
```
my-skill/
  agntc.json       ← {"agents": ["claude"]}
  SKILL.md         ← starter template
```

**Brownfield:**
```
my-skill/
  agntc.json       ← {"agents": ["claude"]}
  (existing files untouched)
```

### Plugin

**Greenfield** (example: skills + hooks selected):
```
my-plugin/
  agntc.json       ← {"agents": ["claude"]}
  skills/
    my-skill/
      SKILL.md     ← starter template
  hooks/
```

Only selected asset dirs are created. Each `skills/` dir gets a starter subdirectory with a `SKILL.md`. Other asset dirs (`agents/`, `hooks/`) are created empty.

**Brownfield:**
```
my-plugin/
  agntc.json       ← {"agents": ["claude"]}
  (existing files untouched)
```

### Collection

**Greenfield:**
```
my-collection/
  agntc.json       ← {"agents": ["claude"]}
  my-plugin/
    agntc.json     ← {"agents": ["claude"]}
    skills/
      my-skill/
        SKILL.md   ← starter template
    agents/
    hooks/
```

The example `my-plugin/` subdir has full structure (all asset dirs + starter skill) so the author sees the complete pattern. The author renames, edits, and duplicates this template. No interactive loop for adding multiple plugins.

**Brownfield:**
```
my-collection/
  agntc.json       ← {"agents": ["claude"]}
  (existing subdirectories untouched)
```

Message: "Created collection config. Add `agntc.json` to each plugin subdirectory as needed."
