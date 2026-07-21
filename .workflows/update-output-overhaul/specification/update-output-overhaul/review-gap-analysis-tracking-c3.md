---
status: in-progress
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
**Affects**: *Partial collections & counts* (line 188), *Safe-vs-Major Bump Gating → Blocking message* (line 248) and *0.x-line + exact-pin edge cases* (line 254), *Failure isolation & lifecycle → Check/resolve failure* (line 112), Acceptance criteria 4 and 8

**Details**:
The trailing-summary and out-of-constraint-footer collapse is described as "**one line per repo-group**," under a bullet headed "**Per-repo collapse** spans every trailing category," with the worked example labelled `owner/repo: 7 up to date`. The term "repo-group" and the "per-repo" framing are used interchangeably, but the collapse *unit* is never pinned to a concrete key.

This matters because the grouping section explicitly admits multiple distinct groups for a single repo — e.g. `owner/repo/a@^1` vs `owner/repo/b@^2` (line 50) are different groups (different `constraint`), and a branch entry vs a caret entry for the same repo are different groups (line 50). For such a repo:

- If an implementer reads "per-repo collapse" literally and collapses by *repo*, two distinct-constraint groups merge into one footer line — and the out-of-constraint footer names a *constraint-specific* current→newer pair (line 247). Merging `^1`'s target with `^2`'s target into a single `owner/repo:` line silently drops one group's out-of-constraint information. That is a correctness bug, not just cosmetics.
- If the implementer collapses by *group* (the reading the rationale actually supports — "group-uniform," "one check per group → one trailing line per repo-group"), correctness holds, but then two groups of the same repo both render a line prefixed `owner/repo:` — a label collision the spec never acknowledges or resolves.

The spec's own rationale points at per-group, but the heading, the "per-repo" phrasing, and the repo-only label invite the wrong reading and leave the same-repo-two-groups rendering undefined. An implementer is left to guess the collapse key and how to disambiguate the label.

**Proposed Addition**:
_Leave blank until discussed._ (Direction: state the collapse key explicitly as the grouping key `(resolvedCloneUrl, versionIntent)`, not the repo, so distinct-intent groups of one repo never merge; and specify how the trailing/footer label reads when a single repo yields more than one group.)

**Resolution**: Pending
**Notes**:

---

### 2. Collapsed trailing-line format is undefined for `check-failed` and `constrained-no-match`

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Partial collections & counts* (line 188), *Failure isolation & lifecycle → Check/resolve failure* (line 112), *Outcome timing* (line 172)

**Details**:
The spec requires collapsing *all* trailing categories to one line per group (line 188) and gives concrete rendered formats for several of them: `up-to-date` collapses to a **count** (`owner/repo: 7 up to date`), clone-failure **enumerates** members (`owner/repo: clone failed — affects N members: a, b, c`, line 194), `newer-tags` reuses existing wording plus a repo-level `add` command (lines 253-254), and out-of-constraint has its actionable line (line 248).

But two of the enumerated trailing categories — `check-failed` and `constrained-no-match` — are named in the collapse list (line 188) with **no rendered format given**. Line 112 says check-failed "collapses to one trailing line per repo-group" and "mirrors clone failure's model-vs-display split," but does not say whether the *line itself* counts members (like `up-to-date`) or enumerates them (like clone-failed), nor what text it carries. `constrained-no-match` gets no collapsed-format treatment at all.

Because both are group-level results (a group's shared resolve probe fails → check-failed for all members; a group's shared constraint matches no tag → constrained-no-match for all members), the natural collapse is a single group-scoped line — but the exact phrasing and whether to count/enumerate members is left for the implementer to invent, and the acceptance tests assert against exact output. This is a small but real output-format gap adjacent to the categories the feature explicitly reformats.

**Proposed Addition**:
_Leave blank until discussed._ (Direction: give the collapsed one-line format for `check-failed` and `constrained-no-match`, consistent with the count-vs-enumerate choice already made for the other trailing categories.)

**Resolution**: Pending
**Notes**:

---
