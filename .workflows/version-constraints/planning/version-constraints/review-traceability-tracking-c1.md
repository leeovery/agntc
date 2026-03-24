---
status: in-progress
created: 2026-03-24
cycle: 1
phase: Traceability Review
topic: Version Constraints
---

# Review Tracking: Version Constraints - Traceability

## Findings

### 1. Constrained Update Flow missing "never downgrade" safeguard

**Type**: Incomplete coverage
**Spec Reference**: Manifest Storage > Constrained Update Flow, step 3, bullet 3 ("Older tag -- should not occur... but if it does, skip -- never downgrade")
**Plan Reference**: Phase 3, task vc-3-1 (Constrained update check in update-check)
**Change Type**: add-to-task

**Details**:
The spec's Constrained Update Flow explicitly describes three comparison outcomes after resolving the best matching tag: (1) same tag = up to date, (2) newer tag = update, (3) older tag = skip, never downgrade. Task vc-3-1 implements only cases 1 and 2. When the resolved tag differs from the current ref, it always returns `constrained-update-available` without checking whether the resolved tag is actually newer or older than the current ref. The spec explicitly says "if it does, skip -- never downgrade" as a defensive safeguard. While `maxSatisfying` should always return the highest match, the spec calls this out as a case to handle (e.g., if the current ref was manually set to a version higher than what the constraint range allows).

**Current**:
In vc-3-1 Do section, step 8:
```
8. Compare the resolved within-constraint tag name (`resolvedResult.original`) against `currentRef`:
   - If same tag name: return `{ status: "constrained-up-to-date", outOfConstraint? }`
   - If different: fetch the commit SHA for the resolved tag via `execGit(["ls-remote", url, "refs/tags/" + resolvedResult.original])`, parse the SHA, and return `{ status: "constrained-update-available", tag: resolvedResult.original, commit: sha, outOfConstraint? }`
```

In vc-3-1 Acceptance Criteria (relevant entries):
```
- [ ] Constrained entry with newer tag in bounds returns `"constrained-update-available"` with the tag name and commit
- [ ] Constrained entry already at best tag returns `"constrained-up-to-date"`
```

In vc-3-1 Tests (no test for downgrade case).

In vc-3-1 Edge Cases (no mention of downgrade/older tag).

**Proposed**:
In vc-3-1 Do section, step 8 (replace existing step 8):
```
8. Compare the resolved within-constraint tag name (`resolvedResult.original`) against `currentRef`:
   - If same tag name: return `{ status: "constrained-up-to-date", outOfConstraint? }`
   - If different and the resolved version is higher than the current version (use `semver.gt(resolvedResult.cleaned, semver.clean(currentRef) ?? "0.0.0")`): fetch the commit SHA for the resolved tag via `execGit(["ls-remote", url, "refs/tags/" + resolvedResult.original])`, parse the SHA, and return `{ status: "constrained-update-available", tag: resolvedResult.original, commit: sha, outOfConstraint? }`
   - If different but the resolved version is not higher (defensive -- should not occur since maxSatisfying returns the highest match): return `{ status: "constrained-up-to-date", outOfConstraint? }` -- never downgrade
```

In vc-3-1 Acceptance Criteria, add after the "already at best tag" criterion:
```
- [ ] Constrained entry where resolved tag is older than current ref returns `"constrained-up-to-date"` (never downgrade)
```

In vc-3-1 Tests, add:
```
- `"constrained entry never downgrades when resolved tag is older than current ref"` -- entry has constraint "^1.0" and ref "v1.5.0" (manually set higher than constraint would resolve); ls-remote returns v1.0.0, v1.3.0; maxSatisfying returns v1.3.0 which is lower than v1.5.0; expect status "constrained-up-to-date" (not constrained-update-available)
```

In vc-3-1 Edge Cases, add:
```
- Older resolved tag (never downgrade): if the current ref is higher than the resolved within-constraint best (e.g., manually edited manifest or constraint narrowed after install), skip the update. The spec says this "should not occur" but "if it does, skip -- never downgrade." Defensive check using `semver.gt()`.
```

**Resolution**: Pending
**Notes**:

