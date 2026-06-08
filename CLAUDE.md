# CLAUDE.md

## Project Overview

agntc is a CLI tool for installing AI agent skills from git repos. Supports Claude, Codex, and Cursor through a driver architecture.

## Commands

- `init` — Scaffold new plugin. Interactive type + agent selection. Always emits `agntc.json` (structurally unambiguous layouts).
- `add <source>` — Install from git/local. Semver constraint auto-detection. Interactive agent + plugin selection. `--plugin` flag bundles a skills-only source as one plugin.
- `remove [key]` — Remove plugin(s). Interactive if no arg.
- `update [key]` — Nuke-and-reinstall. Respects version constraints. No arg = all.
- `list` — Dashboard with update status + inline actions (update, remove, change version).

## Source Code Structure

```
src/
  cli.ts                    # Entry point, commander setup
  commands/                 # add, remove, update, list (+ list-*-action), init
  drivers/                  # Agent drivers (claude, codex, cursor) + registry
  init/                     # Plugin scaffolding (skill, plugin, collection)
  source-parser.ts          # Parse owner/repo, URLs, local paths, tree URLs; key<->source-dir
  type-detection.ts         # Structural detection (bare-skill/plugin/collection/not-agntc)
  config.ts                 # Lenient agntc.json read (never throws); KNOWN_AGENTS
  agent-select.ts           # Agent multiselect; KNOWN_AGENTS default when no declaration
  collection-select.ts      # Collection member multiselect
  copy-unit.ts              # Unified bare-skill vs plugin copy dispatch
  copy-bare-skill.ts        # Recursive copy of a bare-skill dir (strips agntc.json)
  copy-plugin-assets.ts     # Copy skills/agents/hooks asset dirs
  copy-safety.ts            # Pre-flight path-traversal + symlink-escape guards
  clone-reinstall.ts        # Shared clone-and-reinstall for update + list actions
  nuke-reinstall-pipeline.ts# Derive-before-delete replay + nuke-and-reinstall
  manifest.ts               # Read/write .agntc/manifest.json; type backfill on read
  git-clone.ts              # Shallow clone with retry
  git-utils.ts              # ls-remote, ref resolution
  update-check.ts           # Compare manifest vs remote (incl. constrained checks)
  version-resolve.ts        # Semver tag resolution (resolveVersion, resolveLatestVersion)
  summary.ts                # Format install/remove/update summaries
```

## Key Types

- `AgentId`: `"claude" | "codex" | "cursor"`
- `KNOWN_AGENTS`: The agent candidate list used when config declares no agents
- `AgentDriver`: Detection + routing per agent
- `AgntcConfig`: Shape of `agntc.json` — `{ agents, type? }`; both optional (lenient read)
- `ManifestEntry`: Per-plugin tracking (ref, commit, agents, files, `type?`, constraint, `sourceSubpath?`)
- `DetectedType`: Discriminated union — `bare-skill | plugin | collection | not-agntc`
- `UpdateCheckResult`: Union of update statuses including constrained variants

## Configless Detection

`agntc.json` is **optional**. Directory structure is the sole authority for type, identity, and installability.

- **Structure → type.** `SKILL.md` at root = bare skill; `skills/` + (`agents/`/`hooks/`) = plugin; named member dirs = collection; `skills/`-only root = ambiguous (defaults to a collection menu of inner skills, Vercel-style).
- **Config never signals type.** When present, `agntc.json` carries only `agents` (author restriction) and an optional `type: "plugin"` (the one skills-only disambiguator). Config *presence* is not a type signal.
- **Posture:** missing info → lenient default; contradictory info → loud error. Lenient: malformed/empty config → fall back to `KNOWN_AGENTS`. Loud: a `type`/`--plugin` that contradicts an unambiguous structure → hard pre-flight error.
- **Override precedence:** `--plugin` flag > config `type` > structure (resolves the skills-only case only).
- **Identity = directory basename** throughout; no frontmatter parsing.
- **Copy-safety** (`copy-safety.ts`): pre-flight path-traversal + symlink-escape guards run before any copy on both `add` and `update` (clone-root boundary).

## Asset Routing

| Asset | Claude | Codex | Cursor |
|-------|--------|-------|--------|
| skills | `.claude/skills/` | `.agents/skills/` | `.cursor/skills/` |
| agents | `.claude/agents/` | — | — |
| hooks | `.claude/hooks/` | — | — |

## Version Constraints

- `owner/repo` (bare add) — auto-resolves latest semver tag, stores `^major.minor.patch` constraint
- `owner/repo@^1.0` — explicit constraint, resolves best match within range
- `owner/repo@v2.0.0` — exact tag, no constraint stored
- Constraints stored in `ManifestEntry.constraint`, used by `update` to stay within range
- `list` detail view shows out-of-constraint versions when available
- "Change version" action in `list` strips constraint (pin to exact tag)

## Update Strategy

Nuke-and-reinstall: delete manifest `files`, re-clone at same ref, re-copy for same agents. Constrained plugins resolve best match within constraint range.

- **Replays the recorded `type`** rather than re-detecting — benign source additions are picked up without morphing the unit.
- **Derive-before-delete:** validates the re-cloned tree still supports the recorded type *before* removing any files. Irreconcilable change → abort that entry, install left intact, loud message (manual `remove`+`add` remedy).
- **Legacy backfill:** pre-`type` manifest entries derive `type` from recorded `files` on read, then persist on next write.
- **Per-entry granularity:** collection members are independent entries; one aborting doesn't stop siblings. Command exits non-zero if any entry aborted/errored (partial success).

## Testing

```bash
npm test
```

## Build

```bash
npm build
```

Output: `dist/cli.js`
