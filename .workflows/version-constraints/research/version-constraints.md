# Research: Version Constraints

Exploring Composer-style version constraint syntax for plugin installation and updates, allowing users to control the scope of automatic updates (major, minor, patch).

## Starting Point

What we know so far:
- agntc already supports installing plugins at a specific git tag/ref
- User wants Composer-like version constraint syntax (e.g. ^1.0, ~1.0) to control update scope
- The `update` command should respect constraints to determine which versions to pull
- Three update scopes needed: major, minor, patch — user chooses at install time
- Constraints should be independent of any config settings — stored with the installation

---

## Current System

agntc already has ref support via `@` syntax: `owner/repo@v1.0.0`. The manifest stores both `ref` (user-specified) and `commit` (resolved SHA). The update command has three paths:

- **No ref** — checks if remote HEAD moved, auto-updates
- **Tag ref** (detected by `/^v?\d/`) — finds newer tags via ls-remote, lists them, tells user to re-add manually
- **Branch ref** — checks if branch HEAD moved, auto-updates

No constraint system exists yet. Tag-pinned installs refuse to auto-update.

## Cross-Ecosystem Convention Survey

`^` (caret) and `~` (tilde) are the two dominant operators across npm, Composer, Cargo, and Bundler.

**Caret `^` — pin to major, allow minor+patch:**
- `^1.2.3` → >=1.2.3, <2.0.0
- Consistent across npm, Composer, and Cargo
- Partial versions fill zeros: `^1` = `^1.0.0`, `^1.2` = `^1.2.0`

**Tilde `~` — pin to minor, allow patch only:**
- `~1.2.3` → >=1.2.3, <1.3.0
- Consistent across ecosystems *when all three segments provided*
- Composer has a wart: `~1.2` (two segments) means >=1.2.0, <2.0.0 — same as caret. This is confusing and we won't inherit it.

**Exact pin** — current tag behavior (`v1.2.3` or bare tag), no change needed.

## Proposed Model

- **`^N`** — pin major, allow minor+patch (primary use case)
- **`~N.N`** — pin minor, allow patch only
- **`vN.N.N`** or exact tag — pin exactly (existing behavior)

Partial versions allowed — `^1`, `^1.0`, `^1.0.0` all equivalent. Caret semantics are stable regardless of segment count.

Syntax uses existing `@` convention: `owner/repo@^1`. Familiar from npm. Parser can distinguish constraints from literal refs since `^` and `~` are unambiguous prefixes (no git ref starts with them).

## Open Questions for Discussion

- How should the manifest store constraints vs resolved versions?
- What does `update` output look like when a major version exists but constraint blocks it?
- Pre-1.0 handling — Cargo/Composer treat `^0.x` specially (minor becomes breaking boundary). Do we need this?
- Should `add` without any constraint on a tagged repo default to caret behavior, or stay as exact pin?
