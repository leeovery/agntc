# Specification: Configless Install

## Specification

## Overview

### Goal

Let agntc install any skill, plugin, or collection from an arbitrary git repository **without requiring an `agntc.json`**. The repo's directory structure becomes the sole authority for *type*, *identity*, and *installability*. `agntc.json` becomes optional and, when present, carries only author-side agent restriction plus an optional `type` disambiguator — its *presence* never signals type.

### Problem

Truly configless install does not exist today: every installable unit still requires an `agntc.json`. A bare-`SKILL.md` repo is rejected as `not-agntc`. The anchor case `referodesign/refero_skill` (root `SKILL.md`, no config, zero tags, frontmatter `name: refero-design` ≠ basename `refero_skill`) surfaces three of the hard sub-problems in one repo: structural type detection, identity, and version pinning for an untagged repo.

### Scope framing

Detection is the small part; the weight is integration: identity/naming, manifest keying & lifecycle, agent-selection rework, version pinning for untagged repos, and copy-safety. Most of the integration **reuses machinery agntc already has** — tagless→HEAD tracking, the agent hard-ceiling, collection-as-transport keying, dir-basename identity, and the conflict-prompt for directory collisions.

### Governing posture

A consistent rule runs through the whole feature: **missing info → lenient default; contradictory info → loud error.** (Empty/malformed config falls back to all agents; a declared type that contradicts an unambiguous structure is a hard error.)

### Anchor cases

- **`referodesign/refero_skill`** — bare `SKILL.md`, no config, untagged. The configless headline case.
- **`agentic-workflows`** — `skills/` + `agents/`/`hooks/`, ships `agntc.json: {agents:[claude]}` (Claude-only). A plugin *by structure*; its config survives only to express "Claude-only."

---

## Config Model

A clean split of responsibilities replaces v1's "config means I am installable" rule.

### Responsibility split

- **Type, identity, and installability → derived from directory structure ALONE.** Never from config, never from config *presence*.
- **Agent targeting → optional author override via config.** Absent → installer picks from the predefined agent list at install time; the unit is installable for any agent. Present → author has restricted the targets; agntc honours that list.

### Config shape

`agntc.json` is `{ "agents": [...], "type"?: "plugin" }`:

- **`agents`** (optional) — author-side restriction of target agents. A hard ceiling when valid and non-empty (see *Agent Selection*).
- **`type`** (optional) — author-side disambiguator for the single structurally-ambiguous case only (skills-only repo → bundle vs menu). Reserved strictly for a pure skills-only repo the author wants bundled as a plugin. See *Structural Type Detection*.

### Rules

- **Config is optional and per-unit.** It lives *inside* an installable unit — a bare skill, a plugin, or each member of a collection.
- **A collection is not an installable unit** (it's a container of units), so a collection container **never carries config**.
- **Config *presence* never signals type.** Only an explicit `type` *property* is read, and only to disambiguate the skills-only case. A config carrying only `agents` has zero effect on type. (The v1 "config present → plugin; no root config → collection" boundary-marker behaviour stays dead.)
- **Unknown config keys are ignored** (lenient) — older/newer agntc versions don't choke on each other's configs.
- **No install-command flags for type or unit selection**, except the single narrow `--plugin` installer override defined in *Structural Type Detection*. Unit selection from a collection is via interactive prompt or a source-string selector.

### Rationale

Config is demoted to two narrow, irreducible jobs: author agent-restriction (`agents`) and author bundle-intent for the one ambiguous shape (`type`). Both are genuine author intent that structure cannot express. Everything else about a repo is read from its structure.

---

## Working Notes
