---
status: complete
created: 2026-07-21
cycle: 3
phase: Gap Analysis
topic: update-output-overhaul
---

# Review Tracking: update-output-overhaul - Gap Analysis

## Findings

### 1. Trailing/footer collapse unit ("repo-group") is ambiguous between per-repo and per-group

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Partial collections & counts*, *Safe-vs-Major Bump Gating → Blocking message* and *0.x-line + exact-pin edge cases*, *Failure isolation & lifecycle → Check/resolve failure*, Acceptance criteria 4 and 8

**Details**:
The collapse was described as "one line per repo-group" with "per-repo" framing, but the collapse *unit* was never pinned to a concrete key. Since one repo can hold multiple distinct-intent groups (`@^1` vs `@^2`), collapsing by *repo* would merge them into one footer line and silently drop one group's out-of-constraint info — a correctness bug.

**Resolution**: Approved
**Notes**: Pinned the collapse unit to the **grouping key `(resolvedCloneUrl, versionIntent)`** (per group, not per repo) across *Partial collections & counts*, the gating footer, the newer-tags command bullet, the check/resolve-failure line, and criteria 4 & 8. Added a **Group label** rule: `owner/repo:` in the common single-group-per-repo case, `owner/repo@<intent>:` (`@^1.2.3` / `@v2.0.0` / `@main` / `@HEAD`) when one repo yields multiple groups; the label is shared by header, trailing collapse, and footer. Also aligned residual "per-repo" wording in the granularities and testing sections.

---

### 2. Collapsed trailing-line format is undefined for `check-failed` and `constrained-no-match`

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Partial collections & counts*, *Failure isolation & lifecycle → Check/resolve failure*, *Outcome timing*

**Details**:
The spec collapses all trailing categories to one line per group and gives rendered formats for several, but `check-failed` and `constrained-no-match` were named in the list with no format specified, while peer categories had explicit formats. Acceptance tests assert exact output.

**Resolution**: Approved
**Notes**: Added a **Collapsed trailing formats** bullet defining every category's line: `up-to-date` → count; `newer-tags` → notice + repo-level add command; out-of-constraint → actionable current→newer line; `check-failed` → `owner/repo: check failed — <reason>`; `constrained-no-match` → `owner/repo: no tags satisfy <constraint> — left untouched`. Stated the count-collapse vs enumerate rule: check-failed/constrained-no-match/up-to-date count-collapse (group-level shared result), clone-failure enumerates members (single fatal group action).

---
