---
status: in-progress
created: 2026-03-23
cycle: 3
phase: Gap Analysis
topic: version-constraints
---

# Review Tracking: version-constraints - Gap Analysis

## Findings

### 1. Resolution Algorithm still references semver.coerce() — contradicts Tag Normalization Pipeline

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Version Resolution (Resolution Algorithm vs Tag Normalization Pipeline)

**Details**:
The Resolution Algorithm subsection (step 3) says "Use `semver.coerce()` for parsing/normalizing tag formats." The Tag Normalization Pipeline subsection, added in cycle 1 to resolve this exact ambiguity, explicitly states "`semver.coerce()` will not be used -- it's too aggressive and could match non-version tags. `semver.clean()` plus `semver.valid()` is the correct pipeline."

These two subsections describe overlapping but contradictory approaches. An implementer reading top-to-bottom would encounter `coerce()` as the prescribed method in the Resolution Algorithm, then encounter its explicit rejection in the Tag Normalization Pipeline. The Resolution Algorithm was not updated when the Tag Normalization Pipeline was added.

The Resolution Algorithm's step 3 should reference `semver.clean()` instead of `semver.coerce()`, aligning it with the authoritative Tag Normalization Pipeline below.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:
