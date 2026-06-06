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

## Working Notes
