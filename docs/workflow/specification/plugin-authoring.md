---
topic: plugin-authoring
status: in-progress
type: feature
date: 2026-02-10
sources:
  - name: plugin-init-scaffolding
    status: incorporated
---

# Specification: Plugin Authoring

## Overview

`npx agntc init` is a plugin author tool that scaffolds new plugin repos for agntc. It asks a few questions and generates the correct directory structure and `agntc.json` so authors don't need to learn conventions manually.

This command is **author-facing, not consumer-facing**. It runs in the author's plugin repo and produces a structure that's installable via `npx agntc add`.

## Command Signature

```
npx agntc init
```

No arguments. No flags. All configuration happens through interactive prompts using @clack/prompts.

## Init Flow

### Step 1: Pre-check

If `agntc.json` already exists at the current root (or for collections, in any immediate subdirectory), warn "This directory is already initialized." Offer to reconfigure or cancel. Reconfigure re-runs the flow and overwrites existing generated files.

### Step 2: Type Selection

```
What are you creating?

  ● Skill — a single skill (SKILL.md)
  ○ Plugin — skills, agents, and/or hooks that install together as one package
  ○ Collection — a repo of individually selectable plugins
```

No `name` or `description` prompts. The directory name is the plugin's identity — `agntc.json` has no name field and the manifest keys by `owner/repo` path.

### Step 3: Agent Selection

```
Which agents is this built for?

  ○ Claude
  ○ Codex
```

The author declares which agents their plugin supports. No pre-selection — this is a declaration of intent, not a detection of what's installed.

At least one agent must be selected — empty selection is not valid.

### Step 4: Preview and Confirm

Show the files that will be created, then ask for confirmation:

**Skill:**
```
This will create:

  agntc.json
  SKILL.md

Proceed? (y/n)
```

**Plugin:**
```
This will create:

  agntc.json
  skills/
    my-skill/
      SKILL.md
  agents/
  hooks/

Proceed? (y/n)
```

**Collection:**
```
This will create:

  my-plugin/
    agntc.json
    skills/
      my-skill/
        SKILL.md
    agents/
    hooks/

Proceed? (y/n)
```

Collections have no root `agntc.json` — they are identified by the absence of a root config. The `add` command detects a collection by scanning immediate subdirectories for `agntc.json`.

Plugins scaffold all three asset directories (`skills/`, `agents/`, `hooks/`). If the author doesn't need one, they delete it.

### Step 5: Scaffold

Write the previewed files. If a file or directory already exists, skip it — don't overwrite. Report what was created and what was skipped.

### Step 6: Done

Show a brief success message:

- **Skill**: "Done. Edit `SKILL.md` to define your skill."
- **Plugin**: "Done. Add your skills, agents, and hooks."
- **Collection**: "Done. Rename `my-plugin/` and duplicate for each plugin in your collection."

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

## Dependencies

No blocking dependencies. The `init` command is self-contained — it writes files based on the author's selections without calling into any other part of the system.

It shares knowledge of `agntc.json` schema and directory conventions with the core system, but these are structural conventions, not code dependencies. `init` can be built and shipped independently.
