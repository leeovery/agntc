---
status: in-progress
created: 2026-07-21
cycle: 2
phase: Input Review
topic: update-output-overhaul
---

# Review Tracking: update-output-overhaul - Input Review

## Findings

### 1. Cycle-1 grouping-key precision not propagated to Testing scope & Acceptance criterion 1

**Source**: Discussion — "Per-Repo Clone Dedup › Grouping key — Decision" (lines 222-266, key `(resolvedCloneUrl, ref, constraint)` and "share `resolvedCloneUrl` + `ref` + `constraint`") + the group-first genuine-state-split intent (lines 244-246: "a member already at it is up-to-date while a behind sibling updates — that's genuine state, e.g. a singly-updated member, not a race"); cross-ref cycle-1 gap-analysis finding 1 (grouping-key precision → `versionIntent = constraint ?? ref`).
**Category**: Enhancement to existing topic
**Affects**: Testing & Acceptance › Testing scope ("New coverage" bullet); Testing & Acceptance › Acceptance criterion 1

**Details**:
The cycle-1 gap-analysis revision reframed the grouping key from the discussion's original `(resolvedCloneUrl, ref, constraint)` to `(resolvedCloneUrl, versionIntent)` where `versionIntent = constraint ?? ref` — explicitly **excluding `ref`** for constrained (caret) entries, because `ref` mutates when a member is updated singly and grouping-on-ref would split a collection (contradicting the source's genuine-state-split intent that a singly-updated member stays grouped and reports up-to-date). That precision was applied to the *Grouping key*, *Group-first pipeline*, and *Genuine-state splits* sections.

It was **not** propagated to two downstream sections, which still cite the pre-revision triple-key verbatim:

- Testing scope (spec line 271): "New coverage for the grouped/dedup path: **grouping by `(resolvedCloneUrl, ref, constraint)`**, one clone + one check per group…"
- Acceptance criterion 1 (spec line 277): "A multi-member collection at one **`(resolvedCloneUrl, ref, constraint)`** clones once and runs one update check for the whole group."

Why it matters as a source-comparison issue (not just a wording nit): as written, the acceptance criterion asserts grouping-by-`(url, ref, constraint)`. A *constrained* collection whose members were all added atomically (shared `ref`) satisfies this trivially — but it does **not** assert the source-decided behaviour that a **singly-updated member (now at a different `ref`, still within constraint) still groups with its behind siblings**. So the acceptance contract for "done" under-specifies (and, read literally, contradicts) the source's genuine-state-split decision for constrained groups. The cycle-1 revision that fixed the decision left the "done" criteria testing the un-fixed behaviour. These two references should be brought in line with `(resolvedCloneUrl, versionIntent)` / `versionIntent = constraint ?? ref`, and the coverage/criterion should name the singly-updated-constrained-member-stays-grouped case explicitly.

**Current**:
- Testing scope (line 271): "…**New coverage** for the grouped/dedup path: grouping by `(resolvedCloneUrl, ref, constraint)`, one clone + one check per group, per-member categorization against the shared target, genuine-state splits, clone-failure fan-out to N `failed` outcomes with grouped rendering, per-member reinstall isolation, per-group manifest persistence, and per-repo trailing collapse."
- Acceptance criterion 1 (line 277): "1. A multi-member collection at one `(resolvedCloneUrl, ref, constraint)` clones **once** and runs **one** update check for the whole group."

**Proposed Addition**:
{leave blank until discussed}

**Resolution**: Pending
**Notes**: Traces directly to the cycle-1 grouping-key precision (gap-analysis finding 1) whose "Affects" list did not include Testing scope or Acceptance criterion 1, so those two references were never updated. Recommend aligning both to `(resolvedCloneUrl, versionIntent)` and adding the singly-updated-constrained-member-stays-grouped case to grouped-path coverage. Flagged here because it was requested that cycle-1 revisions be re-verified against source intent; boundary note — the residual references are also an internal-consistency artifact (gap-analysis lane), but the substantive under-assertion of the source's genuine-state-split decision is what makes it a source-comparison concern.

---
