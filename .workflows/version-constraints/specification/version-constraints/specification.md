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

---

## Working Notes

[Optional - capture in-progress discussion if needed]
