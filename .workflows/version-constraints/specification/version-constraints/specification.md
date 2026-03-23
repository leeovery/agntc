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

---

## Working Notes

[Optional - capture in-progress discussion if needed]
