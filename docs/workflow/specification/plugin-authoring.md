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
| **Collection** | Agents multiselect | Example `my-plugin/` subdir (no root config) |

No `name` or `description` prompts. The directory name is the plugin's identity — `agntc.json` has no name field and the manifest keys by `owner/repo` path. Description is unnecessary without a registry.

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
  my-plugin/
    agntc.json     ← {"agents": ["claude"]}
    skills/
      my-skill/
        SKILL.md   ← starter template
    agents/
    hooks/
```

No root `agntc.json` — collections are identified by the absence of a root config. The `add` command detects a collection by scanning immediate subdirectories for `agntc.json`.

The example `my-plugin/` subdir has full structure (all asset dirs + starter skill) so the author sees the complete pattern. The author renames, edits, and duplicates this template. No interactive loop for adding multiple plugins.

**Brownfield:**
No files created — existing subdirectories are untouched.

## Starter File Content

### `agntc.json`

Generated with the author's agent selections:

```json
{
  "agents": ["claude"]
}
```

The `agents` array reflects exactly what was selected in the agent multiselect. No other fields — the schema is intentionally minimal.

For collections, the agent selections are written to each plugin's `agntc.json` — there is no root `agntc.json`.

### `SKILL.md` Template

Generated for bare skills and within plugin `skills/` directories:

```markdown
---
name: my-skill
description: Brief description of what this skill does and when to use it.
---

# My Skill

## Instructions

[Describe what the agent should do when this skill is invoked]
```

The frontmatter follows the [Agent Skills](https://agentskills.io) open standard used by Claude Code. The `name` field becomes the `/slash-command` (lowercase, numbers, hyphens only, max 64 chars). The `description` field tells the agent when to use the skill — it's the only recommended field. All other frontmatter fields (`allowed-tools`, `model`, `context`, etc.) are optional and omitted from the template.

## Success Messages

After scaffolding completes, show a brief summary:

### Skill

- **Greenfield**: "Created skill with `agntc.json` and `SKILL.md`. Edit `SKILL.md` to define your skill."
- **Brownfield**: "Created `agntc.json`. Your existing files are untouched."

### Plugin

- **Greenfield**: "Created plugin with `agntc.json` and asset directories. Add your skills, agents, and hooks."
- **Brownfield**: "Created `agntc.json`. Your existing files are untouched."

### Collection

- **Greenfield**: "Created example plugin in `my-plugin/`. Rename and duplicate for your plugins."
- **Brownfield**: "Add `agntc.json` to each plugin subdirectory as needed."

## Complete Question Flow

### Skill (Bare Skill)

1. **Type selection** → "Skill"
2. **Agent multiselect** → select agents
3. **Scaffold** (greenfield: `agntc.json` + `SKILL.md` / brownfield: `agntc.json` only)
4. **Done message**

### Plugin

1. **Type selection** → "Plugin"
2. **Asset multiselect** → select asset types (skills pre-selected)
3. **Agent multiselect** → select agents
4. **Scaffold** (greenfield: `agntc.json` + selected asset dirs + starter skill / brownfield: `agntc.json` only)
5. **Done message**

### Collection

1. **Type selection** → "Collection"
2. **Agent multiselect** → select agents
3. **Scaffold** (greenfield: root `agntc.json` + `my-plugin/` example / brownfield: root `agntc.json` only)
4. **Done message**

### Pre-check (All Types)

Before the type selection prompt, check for `agntc.json` at root:
- If exists → warn "This directory is already initialized." Offer to reconfigure (re-run the flow, overwriting `agntc.json`) or cancel.
- If not exists → proceed to type selection.

## Dependencies

Prerequisites that must exist before implementation can begin:

### Required

| Dependency | Why Blocked | What's Unblocked When It Exists |
|------------|-------------|--------------------------------|
| **Core System** | `init` reuses the agent detection logic and driver/strategy pattern from the core system. The agent multiselect pre-selection depends on the same detection heuristics used by `add`. | All of `init` — type selection, asset selection, agent selection, scaffolding |

### Notes

- The scaffolding output (file writes, directory creation) is self-contained and doesn't call into core system code beyond agent detection
- `agntc.json` schema knowledge is shared but trivial — just `{"agents": [...]}` — so this is a convention dependency, not a code dependency. However, the agent detection infrastructure (driver registration, detection methods) must exist for the agent multiselect to work correctly.
