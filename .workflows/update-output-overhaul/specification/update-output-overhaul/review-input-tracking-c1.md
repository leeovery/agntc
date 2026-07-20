---
status: in-progress
created: 2026-07-20
cycle: 1
phase: Input Review
topic: update-output-overhaul
---

# Review Tracking: update-output-overhaul - Input Review

## Findings

### 1. Group-level check failure has no place in the failure taxonomy

**Source**: Discussion — "Per-Repo Clone Dedup › Grouping key" (group-first: "one `checkForUpdate` per group") + "Failure isolation — Decision" (lines 223-254, 296-333); Discussion — "Per-Unit Progress Output › Partial collections & counts" (`check-failed` as a trailing category, lines 173-177)
**Category**: Gap/Ambiguity
**Affects**: Per-Repo Clone Dedup › Failure isolation & lifecycle

**Details**:
Group-first checking makes the update check a **group-level** operation ("one `checkForUpdate`-equivalent probe … per group"). The spec's failure taxonomy enumerates exactly two failure classes — **clone failure (group-fatal)** and **reinstall failure (per-member)** — but a group-level check/resolve can also fail (dead remote, `ls-remote` error), and when it does the whole group has no shared target to categorize against.

Today `check-failed` is a per-member category; under group-first it becomes an inherently group-level event, yet its outcome model is left unstated. The clone-failure case is spelled out with rigor ("Every member of the group becomes a `failed` outcome attributed to its own key … The *model* stays N outcomes … only the *display* groups"), but the symmetric check-failure case is only addressed as a **rendering** matter (collapse to one trailing line, spec line 166) and an **exit-posture** matter (all-mode exit 0, spec line 235). What's missing is the model statement: does a group check-failure fan out to N `check-failed` outcomes (one per member, attributed per key, display-collapsed) the way clone-failure fans out to N `failed`? And is it confirmed no-manifest-mutation (no reinstall ran)?

This is low-stakes because `check-failed` is exit-0 in all-mode and collapses to one display line regardless — but the failure-isolation section is where a reader looks to understand what a group-level failure does, and this third group-level failure mode is absent from it.

**Proposed Addition**:
{leave blank until discussed}

**Resolution**: Pending
**Notes**: Likely resolution is by analogy to clone-failure (N `check-failed` outcomes attributed per key, no manifest mutation since no reinstall ran, display-collapsed to one trailing line, all-mode exit 0). Confirm whether the failure-isolation section should name check-failure as a third class or whether the trailing-category coverage is deemed sufficient.

---

### 2. Dropped KB traceability reference for the v4-branch tag trap

**Source**: Discussion — "Tag-Based Summary Wording › Context" (line 369): "The trap the KB flagged (`update-check-fails-on-branch-ref`): a ref like `v4` can be a *branch*, so the rule must not key off the lexical shape of the ref."
**Category**: Enhancement to existing topic
**Affects**: Tag-Based Summary Wording › Tags-where-tagged vs hash fallback

**Details**:
The discussion attributes the "taggedness is a data property, not a string shape" rule to a specific knowledge-base entry (`update-check-fails-on-branch-ref`). The spec fully captures the *behaviour* (the `clean("v4")` → `null` reasoning and the `v4.0.0`-branch guard) but drops the KB entry citation that motivated the rule. Given the project's active work indexing decisions into the knowledge base (recent commit "index into knowledge base"), the KB cross-reference is a cheap traceability link that ties this rule back to the prior bug it guards against. Purely a traceability/provenance detail — the rule itself is complete without it.

**Current**:
- **Lexical trap closed for free:** `isVersionTag` is `clean()`-based (`version-resolve.ts:30`); `clean("v4")` is `null` (not a full semver), so a `v4` *branch* is correctly not treated as a tag → **hashes**.

**Proposed Addition**:
{leave blank until discussed}

**Resolution**: Pending
**Notes**: Optional/low-priority. Consider whether specs in this project should cite the originating KB entry (`update-check-fails-on-branch-ref`) for rules that guard against a previously-recorded trap. Skip if KB citations aren't a spec convention here.

---
