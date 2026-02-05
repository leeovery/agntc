# Agent Skills Installer (Name TBD)

## Vision

A professional tool for installing skills, agents, and scripts into projects for agentic engineering. Serious tooling for serious software engineers — not vibe coding.

## What It Does

Installs shareable capabilities (skills, agents, commands, hooks, scripts) from git repositories into any project, for any AI coding agent (Claude, Codex, Cursor, Cline, etc.).

## Core Commands

```bash
npx <tbd> add owner/repo           # Install from git
npx <tbd> add owner/repo@v2.0.0    # Specific version/tag
npx <tbd> remove owner/repo        # Remove and cleanup
npx <tbd> update                   # Update all installed
npx <tbd> update owner/repo        # Update specific
npx <tbd> list                     # Show installed
```

## Asset Types

- `skills/` — SKILL.md files with references
- `agents/` — Agent definition files
- `commands/` — Slash commands
- `hooks/` — Pre/post hooks
- `scripts/` — Shell scripts

## Installation Flow

1. Clone repo to temp/cache location
2. Discover assets (skills/, agents/, scripts/, etc.)
3. Copy to project's `.claude/` (or `.cursor/`, etc.)
4. Update manifest with version/commit info

## Manifest (`.claude/.skills-manifest.json`)

```json
{
  "leeovery/claude-technical-workflows": {
    "version": "2.1.5",
    "commit": "abc123",
    "installedAt": "2026-02-05T15:00:00Z",
    "files": ["skills/technical-planning", "agents/task-executor.md", "..."]
  }
}
```

## Tech Stack

- TypeScript
- @clack/prompts (beautiful CLI output)
- commander (arg parsing)
- Simple git operations (clone, fetch tags)

## Optional Features

- `--with-hook` — Inject postinstall sync into package.json
- `--global` — Install to user directory
- `--agent claude|cursor|codex` — Target specific agent
- Interactive mode vs `--yes` for CI

## Differences from Claude Manager

| Claude Manager | New Tool |
|----------------|----------|
| npm dependency | Standalone npx |
| node_modules source | Git repos |
| postinstall hooks | Explicit add command |
| Claude-only | Multi-agent |

## Name Ideas (parking lot)

Theme: Teaching/educating AI agents for serious agentic engineering work.

TBD — will revisit.

## Migration Path

Once complete:
1. Update claude-technical-workflows, claude-laravel, claude-nuxt to remove claude-manager dependency
2. Update READMEs with new install instructions
3. Deprecate claude-manager with notice pointing to this tool
