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
- [ ] How should pre-1.0 versions be handled?
      - Cargo/Composer treat `^0.x` specially (minor becomes the breaking boundary)
      - Do we need this complexity or can we keep it simple?
- [ ] Should `add` without any constraint on a tagged repo default to caret behavior, or stay as exact pin?
      - Ergonomics vs explicitness trade-off
- [ ] What is the version resolution algorithm?
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

## Summary

### Key Insights

### Current State
- Questions identified, discussion not yet started

### Next Steps
- [ ] Work through each question
