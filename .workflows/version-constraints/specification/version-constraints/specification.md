# Specification: Version Constraints

## Specification

## Constraint Syntax

agntc will support Composer/npm-style version constraints via the existing `@` syntax.

### Operators

| Operator | Meaning | Example | Range |
|----------|---------|---------|-------|
| `^` (caret) | Pin major, allow minor+patch | `^1.2.3` | `>=1.2.3, <2.0.0` |
| `~` (tilde) | Pin minor, allow patch only | `~1.2.3` | `>=1.2.3, <1.3.0` |
| Exact tag | Pin exactly (existing behavior) | `v1.2.3` | `=1.2.3` |

### Partial Versions

Partial versions fill zeros: `^1` = `^1.0.0`, `^1.2` = `^1.2.0`. Caret semantics are stable regardless of segment count.

### Pre-1.0 Handling

Follows the Cargo/npm convention — no custom rules:

- `^0.2.3` → `>=0.2.3, <0.3.0` (minor is breaking boundary)
- `^0.0.3` → `>=0.0.3, <0.0.4` (patch is breaking boundary)
- `^1.0.0`+ → normal behavior (`>=1.0.0, <2.0.0`)

This gives plugin authors the standard semver tools to communicate breaking changes at `0.x` without prematurely committing to `1.0`.

### Parser Disambiguation

Constraints are unambiguous — no git ref starts with `^` or `~`. The source parser can distinguish constraints from literal refs by prefix.

## Manifest Storage

A new `constraint` field will be added to manifest entries alongside the existing `ref` and `commit` fields. The `constraint` field captures user *intent* (e.g. "I want compatible 1.x updates"), while `ref` + `commit` capture *current state*. These shift independently — on `update`, `ref` and `commit` change while `constraint` stays fixed.

### Entry Shape

```json
{ "constraint": "^1.0", "ref": "v1.2.3", "commit": "abc123" }
```

- `constraint` — the constraint expression (e.g. `^1.0`, `~1.2`)
- `ref` — the resolved git ref (tag) currently checked out
- `commit` — the resolved SHA

For non-constrained installs, `constraint` is absent. Its absence is the signal — no need for a sentinel value.

### Update Routing

The presence or absence of `constraint` determines update behavior:

| State | Behavior |
|-------|----------|
| `constraint` present | Resolve against tags, update within bounds |
| `constraint` absent + tag ref | Existing behavior (refuse auto-update) |
| `constraint` absent + branch ref | Existing behavior (track branch HEAD) |
| `constraint` absent + no ref | Existing behavior (track HEAD) |

### Migration

No migration needed — `constraint` is purely additive. Old manifest entries without it behave exactly as before.

## Version Resolution

Version resolution will use the `semver` npm package rather than a custom implementation.

### Dependency

Add `semver` as a production dependency (alongside `commander` and `@clack/prompts`). Use `@types/semver` for TypeScript support. The package is ~50KB with zero dependencies.

### Resolution Algorithm

1. Fetch all refs via `ls-remote`
2. Filter to semver-valid tags using `semver.valid()` (non-semver tags are naturally excluded)
3. Use `semver.coerce()` for parsing/normalizing tag formats
4. Pass filtered tags and the constraint to `semver.maxSatisfying(tags, constraint)` to select the best match

`semver.maxSatisfying` handles all pre-1.0 special casing (`^0.x`, `^0.0.x`) automatically — no custom logic needed.

### No Match

If `maxSatisfying` returns `null` (no tags satisfy the constraint), report this to the user. This covers cases like a constraint of `^2.0` when only `v1.x` tags exist.

## Add Command Behavior

### Default Behavior (Bare Add)

`agntc add owner/repo` (no `@` suffix) will resolve the latest semver tag and auto-apply a `^X.Y.Z` constraint. This mirrors npm/Composer behavior — the documented install path becomes simply `agntc add owner/repo` with no version syntax needed.

If no semver tags exist, fall back to tracking HEAD with no constraint (existing behavior).

### Resolution Order

The full `add` resolution order:

1. `agntc add owner/repo` — resolve latest semver tag, apply `^X.Y.Z`
2. `agntc add owner/repo@^1` — explicit constraint, resolve best match
3. `agntc add owner/repo@~1.2` — explicit constraint, resolve best match
4. `agntc add owner/repo@v1.2.3` — exact pin, no constraint
5. `agntc add owner/repo@main` — track branch HEAD, no constraint
6. `agntc add owner/repo` (no semver tags) — fall back to HEAD, no constraint

The `@^` and `@~` forms are power-user options. The `@branch` syntax (`@main`, `@develop`, feature branches) is kept as an escape hatch for testing PRs or unreleased work.

### Explicit Tags Are Exact Pins

`agntc add owner/repo@v1.2.3` means exact pin — no constraint applied. If you typed a specific version, you meant it. The `@^1` syntax exists for when you want constraints.

### Semver Compliance

Semver compliance by plugin authors cannot be enforced — same as npm/Composer. The constraint system is a trust-based contract. Semver tagging will be recommended in authoring docs.

---

## Working Notes

[Optional - capture in-progress discussion if needed]
