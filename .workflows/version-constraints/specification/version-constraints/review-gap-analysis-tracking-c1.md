---
status: in-progress
created: 2026-03-23
cycle: 1
phase: Gap Analysis
topic: version-constraints
---

# Review Tracking: version-constraints - Gap Analysis

## Findings

### 1. Tag format normalization not fully specified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Version Resolution (Resolution Algorithm)

**Details**:
The spec says to use `semver.valid()` to filter tags and `semver.coerce()` for normalization, but does not specify the exact pipeline. Key ambiguity: should the constraint matching use the original tag string (e.g. `v1.2.3`) or the coerced/cleaned version (e.g. `1.2.3`)? This matters because `semver.maxSatisfying` needs the version strings to match what gets stored in `ref`.

Additionally, `semver.coerce()` is quite aggressive -- it will coerce strings like `release-1.2.3` or `build-42` into semver versions, which may not be desirable. The spec says `semver.valid()` filters first, but `semver.valid("v1.2.3")` returns `"1.2.3"` (strips the v prefix), while `semver.valid("1.2.3")` returns `"1.2.3"`. If `valid()` is the filter, `coerce()` is redundant for already-valid tags. If `coerce()` is the primary tool, then `valid()` filtering is misleading.

An implementer needs to know: (a) the exact sequence of filter/normalize operations, (b) whether to use `semver.clean()` (strips `v` prefix, less aggressive) instead of or alongside `coerce()`, and (c) whether `ref` stores the original tag name (e.g. `v1.2.3`) or the normalized semver string (e.g. `1.2.3`).

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Tag Normalization Pipeline subsection under Version Resolution. Clarifies clean() over coerce(), original tag stored in ref.

---

### 2. Tilde partial version behavior unspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Constraint Syntax (Partial Versions)

**Details**:
The Partial Versions section says "Partial versions fill zeros: `^1` = `^1.0.0`, `^1.2` = `^1.2.0`. Caret semantics are stable regardless of segment count." This only addresses caret behavior. Tilde partials are not addressed. What does `~1` resolve to? `~1.0.0` (which means `>=1.0.0, <1.1.0`) would be very restrictive compared to what a user typing `~1` might expect. Since the `semver` npm package handles this automatically, the spec could simply state that partial version behavior follows `semver` package conventions for both operators, but currently it only mentions caret.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Updated Partial Versions subsection to include tilde partials alongside caret.

---

### 3. Source parser integration with constraint extraction unclear

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Constraint Syntax (Parser Disambiguation), Add Command Behavior

**Details**:
The spec says "no git ref starts with `^` or `~`" so the parser can distinguish constraints from literal refs by prefix. However, the existing `source-parser.ts` extracts everything after `@` as a `ref` string. The spec doesn't specify where the constraint-vs-ref classification happens in the pipeline:

1. Does the source parser itself detect `^`/`~` prefixes and return a different parsed type (e.g. a `constraint` field on `ParsedSource`)?
2. Or does the add command receive the raw ref string and inspect it?
3. For the default bare-add case, who is responsible for the "resolve latest semver tag and apply `^X.Y.Z`" logic -- the parser, the add command, or a new resolution module?

The current `ParsedSource` types have `ref: string | null` but no `constraint` field. An implementer would need to decide the architectural boundary between parsing and resolution.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Parser Output subsection under Constraint Syntax. Parser classifies, add command resolves.

---

### 4. Re-add with changed constraint not addressed

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Add Command Behavior, Manifest Storage

**Details**:
The spec covers the initial add flow well but doesn't address what happens when a user re-adds an already-installed plugin with a different constraint. For example:

- Plugin installed with `^1.0`, user runs `agntc add owner/repo@^2.0`
- Plugin installed with `^1.0`, user runs `agntc add owner/repo@v1.5.0` (exact pin, removing constraint)
- Plugin installed with exact pin, user runs `agntc add owner/repo` (bare add, should it now get a constraint?)

The existing code already handles re-add (nuke old files, reinstall), so the manifest entry would be overwritten. But the spec should confirm that re-add simply overwrites the constraint (or absence thereof) per the resolution order rules -- or if there's a confirmation prompt when changing constraint strategy.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Re-Add Behavior subsection under Add Command Behavior. Overwrites via standard nuke-and-reinstall, no confirmation prompt.

---

### 5. Update output UX doesn't address single-plugin update case

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Update Output UX

**Details**:
The Update Output UX section says "Same format regardless of single-plugin or batch update." The example shows a batch format with multiple plugins. For `agntc update owner/repo` (single plugin), does the output still show the collated info section? The current single-plugin update code path uses `p.outro()` for its output (a different formatting style than the batch mode).

The spec should clarify whether the single-plugin update path also gets the "Newer versions outside constraints" info line when the constrained update resolves to "already up to date" but newer out-of-constraint versions exist.

**Proposed Addition**:

**Resolution**: Skipped
**Notes**: Already covered by "Same format regardless of single-plugin or batch update." Implementation detail, not a spec gap.

---

### 6. How "latest semver tag" is determined for bare add

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Add Command Behavior (Default Behavior)

**Details**:
The spec says bare `agntc add owner/repo` resolves "the latest semver tag." The resolution algorithm in the Version Resolution section describes filtering to semver-valid tags and using `maxSatisfying`. But for the bare-add case there is no constraint yet -- the constraint is derived from the result. The spec doesn't say how to find the "latest" tag:

- Is it `semver.maxSatisfying(tags, '*')` (which would pick the highest semver tag)?
- Is it `semver.rsort(tags)[0]` (sort descending, take first)?
- Does it include pre-release tags (e.g. `2.0.0-beta.1`)?

The `semver` package treats pre-release versions specially -- `maxSatisfying(['1.0.0', '2.0.0-beta.1'], '*')` returns `1.0.0`, not the beta. The spec should clarify whether pre-release tags are included or excluded when determining the "latest" for auto-constraint.

**Proposed Addition**:

**Resolution**: Approved
**Notes**: Added Latest Tag Resolution subsection under Add Command Behavior. Uses maxSatisfying with '*', excludes pre-releases.

---

### 7. List command and change-version action interaction with constraints

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest Storage, Update Output UX

**Details**:
The spec focuses on `add` and `update` commands but doesn't address how constraints interact with the existing `list` command. The codebase has `list-change-version-action.ts` which lets users pick from newer tags. With constraints:

- Should the list dashboard show the constraint alongside the ref?
- Should the "change version" action respect the constraint bounds, or allow any version?
- Should the list's update status indicator differentiate between "update available within constraint" vs "update available outside constraint"?

These are existing features that will need to interact with the new constraint system, but the spec doesn't address them.

**Proposed Addition**:

**Resolution**: Pending
**Notes**: This could be considered out of scope if the intent is to handle list interactions in a separate pass, but it affects implementation planning since `list` reads manifest entries.

---

### 8. Collection plugins and constraints

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Add Command Behavior, Manifest Storage

**Details**:
The spec doesn't mention how constraints interact with collection installs (`agntc add owner/collection-repo`). Collections install multiple plugins from a single repo, each tracked as a separate manifest entry. Questions:

- Does `agntc add owner/collection@^1.0` apply the `^1.0` constraint to all plugins in the collection?
- Does bare `agntc add owner/collection` auto-apply `^X.Y.Z` based on the repo's latest semver tag?
- On `update`, are all collection plugins constrained together (same constraint resolves to same tag) or independently?

Since collection plugins share a single repo source, they would logically share a single constraint. But the manifest stores them as separate entries (e.g. `owner/collection/plugin-a`, `owner/collection/plugin-b`). Each entry would need its own `constraint` field with the same value, or the constraint would need to live elsewhere.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

