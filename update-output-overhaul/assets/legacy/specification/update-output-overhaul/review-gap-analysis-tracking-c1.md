---
status: complete
created: 2026-07-21
cycle: 1
phase: Gap Analysis
topic: update-output-overhaul
---

# Review Tracking: update-output-overhaul - Gap Analysis

## Findings

### 1. Grouping key `ref` contradicts the genuine-state-split example for constrained members

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Repo Clone Dedup → Grouping key*, *Group-first pipeline*, *Genuine-state splits are intended*; *Tag-Based Summary Wording → Sourcing old/new refs*

**Details**:
The grouping key `(resolvedCloneUrl, ref, constraint)` conflicts with the decided genuine-state-split behaviour: a constrained (caret) entry's `ref` holds its *current resolved tag* and mutates on update (`update-check.ts:218`, `nuke-reinstall-pipeline.ts:117`), so a singly-updated member would key differently from its siblings and split into a separate group — contradicting the decided Key Insight that the singly-updated member stays in the group and reports up-to-date.

**Resolution**: Approved (adjusted — resolution (a), key-precision fix)
**Notes**: Verified the code claim independently. Resolved per option (a): version-intent component is `versionIntent = constraint ?? ref` — constraint when constrained (`ref` excluded, it is the mutable current position), else `ref` (branch/HEAD/exact-pin, fixed). Clone happens at the group's effective ref (stored `ref` for unconstrained, resolved target tag for constrained via `newRef` override). This is a precision on the key matching decided intent (Key Insight #2), analogous to the discussion's own `resolvedCloneUrl` precision (review F1) — not a new decision. Genuine-state-splits section extended to tie the caret case to the `ref` exclusion and the branch/HEAD case to commit-level divergence.

---

### 2. Group-header version move has no defined "old" ref when a group's members diverge

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output → Version move & dropped-agents placement*; *Progress granularities*

**Details**:
The new ref is shared (resolved target) but the old ref is per-member; when updating members diverge in old ref the header's single `old → new` has no defined "old", and a divergent member's actual move is displayed nowhere.

**Resolution**: Approved
**Notes**: Added a header-"old" rule: when updating members share one old (common case — atomic collection) the header shows the shared `old → new`; when olds diverge the header shows only the resolved target and each divergent member carries its own `old → new` on its line. Up-to-date members are excluded from the count and contribute no old.

---

### 3. Local entries have no defined rendering in the overhauled progress stream

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Repo Clone Dedup → Grouping key* (local entries); all of *Per-Unit Progress Output*

**Details**:
Local entries are "excluded from grouping; one reinstall each, unchanged," but the progress section is written entirely around the group-header + per-member model, which locals (no clone, no version move) do not fit. Their line shape and placement were unstated.

**Resolution**: Approved
**Notes**: Added a *Local entries* subsection: renders as a group-of-one `✓ <key>: Refreshed from local path` line (existing local-update wording), no clone spinner / no version move, streamed inline in the actioned phase, subject to per-member isolation and per-entry persistence.

---

### 4. Check-phase sequencing is ambiguous: single upfront phase vs. per-group inline

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Repo Clone Dedup → Group-first pipeline*; *Per-Unit Progress Output → Outcome timing*

**Details**:
The "Net stream" implies a single upfront `Checking for updates…` phase, but the group-first pipeline reads as per-group sequential, and the group spinner carries a version move known only after that group's check. The batched-vs-folded structure and check parallelism were unstated.

**Resolution**: Approved
**Notes**: Added a "two phases" bullet to Outcome timing: a batched upfront check (single `Checking for updates…`, per-group probes may run in parallel as today's `Promise.all` do) resolves every group's target, then only updatable groups stream their `Updating <repo>` spinners in deterministic processing order.

---

### 5. Collapsed all-mode `newer-tags` line: re-add command key granularity unspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Safe-vs-Major Bump Gating → 0.x-line + exact-pin edge cases*; *Partial collections & counts*; Acceptance criterion 9

**Details**:
The single-key `newer-tags` command is key-scoped (`add <key>@<newest>`) but the all-mode line collapses to one line per repo-group, leaving the collapsed command's key granularity ambiguous — unlike the caret footer, which resolved the analogous question.

**Resolution**: Approved
**Notes**: Added a command-granularity bullet: the collapsed all-mode line uses the repo-level `npx agntc add owner/repo@<newest>` (re-adds collection or standalone), mirroring the caret footer; single-key stays member/key-scoped.

---

### 6. "Interrupt leaves the manifest matching disk" is overstated at sub-group granularity

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output → Per-group manifest persistence*; Acceptance criterion 5

**Details**:
The unqualified "matching disk" guarantee holds only at group boundaries; a SIGINT mid-member (after nuke, before re-copy and per-group write) leaves the manifest recording now-deleted files — contradicting the flat guarantee.

**Resolution**: Approved
**Notes**: Qualified the persistence section and criterion 5 to group granularity, naming the mid-member nuke window as the pre-existing SIGINT gap (out of scope, no worse than today).

---

### 7. Non-updatable (fully up-to-date) group: is a `Updating <repo>` spinner shown?

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Per-Unit Progress Output → Outcome timing*; *Progress granularities*

**Details**:
For a group whose check finds every member non-updatable, no clone occurs; the spec didn't state whether it still emits an (empty) `Updating <repo>` header.

**Resolution**: Approved (folded into finding 4)
**Notes**: The two-phase bullet added for finding 4 states non-updatable groups never clone and never emit an `Updating` spinner — silent in the streamed phase, appearing only as their collapsed trailing line.

---
