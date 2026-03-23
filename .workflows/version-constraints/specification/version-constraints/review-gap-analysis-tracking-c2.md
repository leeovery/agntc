---
status: in-progress
created: 2026-03-23
cycle: 2
phase: Gap Analysis
topic: version-constraints
---

# Review Tracking: version-constraints - Gap Analysis

## Findings

### 1. Out-of-constraint version detection not specified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Update Output UX, List Command Integration

**Details**:
The Update Output UX section says to show "Newer versions outside constraints" (e.g. `owner/plugin-a  v2.0.0 available (constraint: ^1.0)`). The List Command Integration says to differentiate "update available within constraint" from "newer version outside constraint." However, the Constrained Update Flow only describes resolving the best tag *within* constraint bounds via `maxSatisfying`. The spec never describes how to detect whether newer versions exist *outside* the constraint.

An implementer would need to: (a) find the absolute latest semver tag across all tags (not just those satisfying the constraint), (b) compare it against the best within-constraint match, and (c) if the absolute latest is higher, surface it in the UX. This is a second resolution pass that is implied by the UX requirements but never described as a step in any flow.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Out-of-Constraint Detection subsection under Manifest Storage.

---

### 2. Constraint support across source types not addressed

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Constraint Syntax (Parser Output), Add Command Behavior

**Details**:
The Parser Output section shows constraint examples only for GitHub shorthand (`owner/repo@^1.0`). The existing codebase has 5 source types: GitHub shorthand, HTTPS URL, SSH URL, direct path, and local path. The spec doesn't clarify which source types support constraints.

For HTTPS URLs (`https://github.com/owner/repo@^1.0`) and SSH URLs (`git@github.com:owner/repo@^1.0`), should the parser detect constraint prefixes the same way? Direct path sources (tree URLs) already pin to a specific ref and reject `@` suffixes. Local path sources have no ref concept. An implementer needs to know whether constraints are shorthand-only or apply to all remote source types.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Source Type Support subsection under Constraint Syntax.

---

### 3. Invalid constraint input handling unspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Constraint Syntax (Parser Output), Add Command Behavior

**Details**:
The spec defines valid constraint syntax (`^X.Y.Z`, `~X.Y.Z`) but doesn't address what happens when the version portion is invalid. For example: `owner/repo@^abc`, `owner/repo@^`, `owner/repo@~`, or `owner/repo@^1.2.3.4`. Since the parser classifies by `^`/`~` prefix, these would be classified as constraints but would fail semver resolution.

Should these be caught at parse time (parser rejects them) or at resolution time (semver functions return null, reported as "no tags satisfy constraint")? The answer affects error messages and UX -- a parse-time error like "invalid constraint syntax" is more helpful than a confusing "no tags satisfy constraint ^abc."

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Constraint Validation subsection under Constraint Syntax. Parse-time rejection via semver.validRange().

---

### 4. Duplicate clean versions from different tag names

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Version Resolution (Tag Normalization Pipeline)

**Details**:
The Tag Normalization Pipeline (step 5) says "Map the matched clean version back to the original tag name." If a repository has both `v1.2.3` and `1.2.3` as tags, `semver.clean()` produces `1.2.3` for both. The pipeline doesn't specify which original tag name to prefer when multiple tags clean to the same version. This is an edge case but could cause non-deterministic behavior.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:
