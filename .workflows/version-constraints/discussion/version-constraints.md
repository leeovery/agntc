# Discussion: Version Constraints

## Context

agntc needs Composer-style version constraint syntax for plugin installations so users can control the scope of automatic updates. Currently, tag-pinned installs (`owner/repo@v1.0.0`) refuse to auto-update entirely — there's no middle ground between "pinned exactly" and "track HEAD."

The research phase established that `^` (caret) and `~` (tilde) are dominant operators across npm, Composer, Cargo, and Bundler with consistent semantics. The proposed model uses the existing `@` syntax: `owner/repo@^1` for major-pinned, `owner/repo@~1.2` for minor-pinned, and bare tags for exact pin.

Key constraints:
- Must integrate with existing ref/commit tracking in the manifest
- Must work with the nuke-and-reinstall update strategy
- Parser must distinguish constraints from literal git refs (unambiguous since no git ref starts with `^` or `~`)

### References

- [Version Constraints Research](./../research/version-constraints.md)

## Questions

- [x] How should the manifest store constraints vs resolved versions?
      - Current manifest has `ref` (user-specified) and `commit` (resolved SHA)
      - Need to store the constraint expression separately from the resolved tag
- [x] What should `update` output look like when a newer major version exists but the constraint blocks it?
      - UX question: inform, warn, or silently skip?
- [x] How should pre-1.0 versions be handled?
      - Cargo/Composer treat `^0.x` specially (minor becomes the breaking boundary)
      - Do we need this complexity or can we keep it simple?
- [x] Should `add` without any constraint on a tagged repo default to caret behavior, or stay as exact pin?
      - Ergonomics vs explicitness trade-off
- [x] What is the version resolution algorithm?
      - How do we select the best matching tag from ls-remote output?
      - How do we handle non-semver tags?
- [x] How should constraint violations during `update` be reported?
      - Single plugin vs batch update scenarios
      - Merged with the update output question above

---

*Each question above gets its own section below. Check off as completed.*

---

## How should the manifest store constraints vs resolved versions?

### Context
The manifest currently tracks `ref` (user-specified git ref) and `commit` (resolved SHA). With constraints, we need to store the constraint expression, the resolved tag, and the commit — three pieces of state instead of two.

### Options Considered

**Option A — Overload `ref`**
- `ref` stores the constraint expression (`^1.0`)
- New `resolvedTag` field for the matched tag (`v1.2.3`)
- `commit` stays as-is
- Pros: Fewer new fields
- Cons: `ref` no longer means "a git ref" — semantic drift

**Option B — Dedicated `constraint` field**
- New `constraint` field stores the expression (`^1.0`)
- `ref` stores the resolved tag (`v1.2.3`)
- `commit` stays as-is
- Pros: `ref` keeps its meaning ("the actual git ref we checked out"), constraint is additive
- Cons: One more field

### Journey
Started with whether to overload `ref` or add a new field. Option B won quickly — `ref` should mean "the git ref we checked out," and a constraint is a different concept (user intent vs resolved state).

Key insight: `constraint` captures *intent* ("I want compatible 1.x updates"), while `ref` + `commit` capture *current state*. These shift independently — on `update`, ref and commit change while constraint stays fixed.

Considered whether exact-pin installs should store `constraint: "v1.2.3"` for explicitness. Rejected — it's redundant with `ref: "v1.2.3"` and would require logic to distinguish "constraint that matches one version" from "exact pin." Absence of `constraint` is the signal.

### Decision
**Option B — dedicated `constraint` field, absent for non-constrained installs.**

Manifest shape: `{ constraint: "^1.0", ref: "v1.2.3", commit: "abc123" }`

Update routing is clean:
- `constraint` present → resolve against tags, update within bounds
- `constraint` absent + tag ref → existing behavior (refuse auto-update)
- `constraint` absent + branch ref → existing behavior (track branch HEAD)
- `constraint` absent + no ref → existing behavior (track HEAD)

No migration needed — `constraint` is purely additive. Old entries without it behave exactly as before.

---

## What should `update` output when a newer version exists outside the constraint?

### Context
When a constrained plugin has a newer version that falls outside its constraint (e.g. `v2.0.0` exists but constraint is `^1.0`), the user should know. But the update command shouldn't be noisy about it — they chose the constraint deliberately.

Also covers: how constraint violations are reported in batch vs single updates (merged the two questions since they're the same concern).

### Options Considered

**Silent** — just report normal update results, don't mention out-of-constraint versions.
- Cons: Hides useful information. User may not know v2 exists.

**Warning** — prominent/colored warning suggesting re-add.
- Cons: Overblown. They chose the constraint; a warning implies they did something wrong.

**Info line** — quiet informational line after update results.
- Pros: Respects user's choice while keeping them informed.

### Journey
Info line was the obvious winner. The real question was placement: inline with each plugin's update result, or collated at the end?

Initially considered showing inline for single-plugin updates and collated for batch. Decided same format regardless of count — simpler logic, same net result for single-plugin case.

For which version to show: considered listing the next major, or all out-of-constraint versions. Settled on latest only — if they're going to bump their constraint, they want to know the ceiling, not every step.

### Decision
**Info line, always collated at the end. Show the latest available version outside the constraint.**

Batch output:
```
✓ owner/plugin-a  v1.2.3 → v1.3.0
✓ owner/plugin-b  (up to date)
✓ owner/plugin-c  v2.1.0 → v2.1.5

ℹ Newer versions outside constraints:
  owner/plugin-a  v2.0.0 available (constraint: ^1.0)
  owner/plugin-b  v3.1.0 available (constraint: ^2.0)
```

Single plugin — same format, info section at the end.

---

## How should pre-1.0 versions be handled?

### Context
Cargo, npm, and Composer treat `^0.x` specially: minor becomes the breaking boundary. So `^0.2.3` means `>=0.2.3, <0.3.0`. The question was whether to adopt this or keep caret semantics uniform.

### Journey
Initial instinct was to skip special handling — simpler, and agntc plugins aren't library APIs. But this fell apart when considering the author's perspective: a pre-1.0 plugin author needs a way to signal breaking changes through semver without being forced to jump to `1.0.0`. If `^0.2` means `<1.0.0`, bumping from `0.2.x` to `0.3.0` to signal a break would be invisible to the constraint — users would auto-update across it.

The key insight: this isn't about whether *we* think skills break the same way as libraries. It's about giving plugin authors the standard semver tools to communicate intent. Tags are the release mechanism — authors push to main freely, and only tag when ready to publish. The convention lets them signal "this minor bump is breaking" at `0.x` without prematurely committing to `1.0`.

Considered implementing only `^0.x` special handling and skipping `^0.0.x` (pinning to patch), but decided to adopt the full convention. It's already well-defined, avoids us making selective decisions about which edge cases to support, and means anyone coming from npm/Cargo/Composer gets exactly what they expect.

### Decision
**Adopt full Cargo/npm convention for pre-1.0:**
- `^0.2.3` → `>=0.2.3, <0.3.0` (minor is breaking boundary)
- `^0.0.3` → `>=0.0.3, <0.0.4` (patch is breaking boundary)
- `^1.0.0`+ → normal behavior (`>=1.0.0, <2.0.0`)

No custom rules. Follow the established convention exactly.

---

## What is the version resolution algorithm?

### Context
Need to select the best matching tag from `ls-remote` output given a constraint expression.

### Decision
**Use the `semver` npm package** rather than implementing our own resolver.

- `semver.maxSatisfying(tags, constraint)` is essentially the entire resolver — pass tags from ls-remote, pass the constraint, get the best match
- Handles all `^0.x` and `^0.0.x` special casing we just agreed to adopt
- `semver.valid()` and `semver.coerce()` for parsing/filtering tags
- Battle-tested by every `npm install` ever run
- Tiny (~50KB), zero dependencies
- Has `@types/semver` for TypeScript

Non-semver tags are handled naturally — `semver.valid()` filters them out before matching. No custom logic needed.

This avoids reimplementing well-defined behaviour and getting edge cases wrong. Added as a production dependency alongside `commander` and `@clack/prompts`.

---

## Should `add` without a constraint default to caret, or stay as exact pin?

### Context
When a user types `agntc add owner/repo@v1.2.3` (explicit tag), should we auto-apply a `^` constraint? And separately, what should bare `agntc add owner/repo` (no `@` at all) do?

### Journey
Started with the narrow question: should `@v1.2.3` imply `^1.2.3`? Quickly agreed no — explicit tag means exact pin. If you typed a specific version, you meant it. The `@^1` syntax exists for when you want constraints.

This opened a bigger question inspired by npm/Composer: those tools don't require you to specify a version at all. `npm install foo` resolves latest and applies `^` automatically. Could agntc do the same?

The difference: npm/Composer have registries with a "latest stable" concept. agntc installs from git repos. But we can approximate it — `ls-remote` gives us all tags, `semver.valid()` filters to semver ones, and we pick the latest. If semver tags exist, we have a "latest stable."

This led to: bare `agntc add owner/repo` should resolve the latest semver tag and auto-apply `^X.Y.Z`. The documented install path becomes just `agntc add owner/repo` — clean, no version syntax needed. The `@^1` and `@v1.2.3` forms are power-user options that still work but aren't the advertised path.

On enforcement: we can't guarantee authors follow semver, but neither can npm or Composer. The constraint system is a trust-based contract. We recommend semver in authoring docs and trust that tagged releases follow it.

Brief detour on `^1` vs `^1.2.3` as the default — concluded it doesn't matter. Upper bound is identical, floor only differs for downgrades which aren't a thing. `^1.2.3` is more precise and matches npm convention.

Also discussed `@branch` syntax (`@main`, `@develop`, feature branches). Keeping it — it's an existing code path, useful for testing PRs or unreleased work. Not advertised as primary install path but valuable as an escape hatch.

### Decision
**Bare `add` defaults to latest semver tag with caret constraint. Explicit tags are exact pins.**

Full `add` resolution order:
1. `agntc add owner/repo` — resolve latest semver tag, apply `^X.Y.Z`
2. `agntc add owner/repo@^1` — explicit constraint, resolve best match
3. `agntc add owner/repo@~1.2` — explicit constraint, resolve best match
4. `agntc add owner/repo@v1.2.3` — exact pin, no constraint
5. `agntc add owner/repo@main` — track branch HEAD, no constraint
6. `agntc add owner/repo` (no semver tags) — fall back to HEAD, no constraint

The documented install path for plugin READMEs is simply `agntc add owner/repo`. No version syntax in getting-started docs.

---

## Summary

### Key Insights
1. Constraint captures user *intent*, ref/commit capture *current state* — these shift independently
2. The `semver` npm package handles all resolution including pre-1.0 edge cases — no need to reimplement
3. Bare `add` should behave like npm/Composer: resolve latest, apply caret — the version syntax is power-user territory
4. Can't enforce semver compliance, but neither can npm/Composer — it's a trust-based contract

### Current State
- All questions resolved

### Next Steps
- [ ] Proceed to specification
